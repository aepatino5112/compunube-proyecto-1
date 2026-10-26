package matchstore

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestPostgresConcurrentClaimAndRestart(t *testing.T) {
	url := testDatabaseURL(t)
	ctx := context.Background()
	store, err := Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	record := fixture()
	suffix := time.Now().Format("20060102150405.000000000")
	record.RoomID += "-claim-" + suffix
	record.RaceID += "-claim-" + suffix
	record.Result.RoomID = record.RoomID
	record.Result.RaceID = record.RaceID
	t.Cleanup(func() {
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.settlement_delivery WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.race_participants WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.races WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.rooms WHERE room_id=$1`, record.RoomID)
		store.Close()
	})
	if err = store.Save(ctx, record); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	lease := 5 * time.Second
	var wg sync.WaitGroup
	claims := make(chan Delivery, 2)
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d, ok, e := store.ClaimDue(ctx, now, lease)
			if e != nil {
				errs <- e
				return
			}
			if !ok {
				errs <- ErrStaleClaim
				return
			}
			claims <- d
		}()
	}
	wg.Wait()
	close(claims)
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	got := map[string]Delivery{}
	for d := range claims {
		if d.RaceID != record.RaceID || d.RoomID != record.RoomID || d.AttemptCount != 1 {
			t.Fatalf("bad claim: %+v", d)
		}
		got[d.PlayerID] = d
	}
	if len(got) != 2 {
		t.Fatalf("concurrent workers claimed same row: %+v", got)
	}
	if _, ok, err := store.ClaimDue(ctx, now, lease); err != nil || ok {
		t.Fatalf("leased row claimed twice: %v %v", ok, err)
	}
	all, err := store.Confirm(ctx, got["b"], now)
	if err != nil || all {
		t.Fatalf("first confirm: %v %v", all, err)
	}
	store.Close()
	store, err = Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	reclaimed, ok, err := store.ClaimDue(ctx, now.Add(lease+time.Second), lease)
	if err != nil || !ok || reclaimed.PlayerID != "a" || reclaimed.AttemptCount != 2 {
		t.Fatalf("restart recovery: %+v %v %v", reclaimed, ok, err)
	}
	if _, err = store.Confirm(ctx, got["a"], now); err != ErrStaleClaim {
		t.Fatalf("stale worker confirmed: %v", err)
	}
	future := now.Add(lease + time.Minute)
	if err = store.Retry(ctx, reclaimed, future, "UNAVAILABLE"); err != nil {
		t.Fatal(err)
	}
	if _, ok, err = store.ClaimDue(ctx, now.Add(lease+2*time.Second), lease); err != nil || ok {
		t.Fatalf("backoff ignored: %v %v", ok, err)
	}
	again, ok, err := store.ClaimDue(ctx, future.Add(time.Second), lease)
	if err != nil || !ok || again.PlayerID != "a" || again.AttemptCount != 3 {
		t.Fatalf("retry claim: %+v %v %v", again, ok, err)
	}
	all, err = store.Confirm(ctx, again, future.Add(time.Second))
	if err != nil || !all {
		t.Fatalf("global confirmation: %v %v", all, err)
	}
	var confirmedCount int
	if err = store.pool.QueryRow(ctx, `SELECT count(*) FROM match.settlement_delivery WHERE race_id=$1 AND state='confirmed' AND confirmed_at IS NOT NULL`, record.RaceID).Scan(&confirmedCount); err != nil {
		t.Fatal(err)
	}
	if confirmedCount != 2 {
		t.Fatalf("confirmed_at missing: %d", confirmedCount)
	}
	due, err := store.Due(ctx, future.Add(2*time.Second), 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range due {
		if d.RaceID == record.RaceID {
			t.Fatal("confirmed delivery still due")
		}
	}
}

func TestPostgresPermanentFailureIsNotReclaimed(t *testing.T) {
	url := testDatabaseURL(t)
	ctx := context.Background()
	store, err := Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	record := fixture()
	suffix := time.Now().Format("20060102150405.000000000")
	record.RoomID += "-failed-" + suffix
	record.RaceID += "-failed-" + suffix
	record.Result.RoomID = record.RoomID
	record.Result.RaceID = record.RaceID
	t.Cleanup(func() {
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.settlement_delivery WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.race_participants WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.races WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.rooms WHERE room_id=$1`, record.RoomID)
		store.Close()
	})
	if err = store.Save(ctx, record); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	first, ok, err := store.ClaimDue(ctx, now, time.Minute)
	if err != nil || !ok {
		t.Fatalf("claim: %v %v", ok, err)
	}
	if err = store.Fail(ctx, first, "CONFLICT"); err != nil {
		t.Fatal(err)
	}
	failed, err := store.Failed(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, d := range failed {
		if d.RaceID == record.RaceID && d.PlayerID == first.PlayerID {
			found = true
		}
	}
	if !found {
		t.Fatal("permanent failure not visible for diagnosis")
	}
	for i := 0; i < 2; i++ {
		d, ok, err := store.ClaimDue(ctx, now.Add(2*time.Minute), time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if ok && d.RaceID == record.RaceID && d.PlayerID == first.PlayerID {
			t.Fatal("permanent failure reclaimed")
		}
	}
}

func TestPostgresConcurrentConfirmPublishesOnce(t *testing.T) {
	url := testDatabaseURL(t)
	ctx := context.Background()
	store, err := Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	record := fixture()
	suffix := time.Now().Format("20060102150405.000000000")
	record.RoomID += "-confirm-" + suffix
	record.RaceID += "-confirm-" + suffix
	record.Result.RoomID = record.RoomID
	record.Result.RaceID = record.RaceID
	t.Cleanup(func() {
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.settlement_delivery WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.race_participants WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.races WHERE race_id=$1`, record.RaceID)
		_, _ = store.pool.Exec(ctx, `DELETE FROM match.rooms WHERE room_id=$1`, record.RoomID)
		store.Close()
	})
	if err = store.Save(ctx, record); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	a, ok, err := store.ClaimDue(ctx, now, time.Minute)
	if err != nil || !ok {
		t.Fatalf("first claim: %v %v", ok, err)
	}
	b, ok, err := store.ClaimDue(ctx, now, time.Minute)
	if err != nil || !ok {
		t.Fatalf("second claim: %v %v", ok, err)
	}
	results := make(chan bool, 2)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, d := range []Delivery{a, b} {
		wg.Add(1)
		go func(d Delivery) {
			defer wg.Done()
			all, err := store.Confirm(ctx, d, now)
			if err != nil {
				errs <- err
			} else {
				results <- all
			}
		}(d)
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	allCount := 0
	for all := range results {
		if all {
			allCount++
		}
	}
	if allCount != 1 {
		t.Fatalf("all-confirmed transition emitted %d times", allCount)
	}
}
