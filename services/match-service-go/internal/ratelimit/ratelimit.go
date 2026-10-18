package ratelimit

import "time"

// Bucket is owned by one WebSocket reader; it needs no shared lock.
type Bucket struct {
	rate, burst, tokens float64
	last                time.Time
	Rejected            uint64
}

func New(rate, burst int) *Bucket {
	if rate <= 0 || burst <= 0 {
		panic("invalid input rate")
	}
	return &Bucket{rate: float64(rate), burst: float64(burst), tokens: float64(burst)}
}
func (b *Bucket) Allow(now time.Time) bool {
	if b.last.IsZero() {
		b.last = now
	}
	if now.After(b.last) {
		b.tokens += now.Sub(b.last).Seconds() * b.rate
		if b.tokens > b.burst {
			b.tokens = b.burst
		}
		b.last = now
	}
	if b.tokens < 1 {
		b.Rejected++
		return false
	}
	b.tokens--
	return true
}
