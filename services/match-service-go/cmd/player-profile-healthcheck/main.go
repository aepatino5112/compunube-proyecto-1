// Command player-profile-healthcheck is a bounded local gRPC Health probe for
// the Rust image's Docker healthcheck. It uses the same service name as Envoy.
package main

import (
	"context"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := grpc.NewClient("127.0.0.1:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		os.Exit(1)
	}
	defer conn.Close()
	response, err := healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{Service: "player_profile"})
	if err != nil || response.GetStatus() != healthpb.HealthCheckResponse_SERVING {
		os.Exit(1)
	}
}
