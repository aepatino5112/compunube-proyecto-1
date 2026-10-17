FROM golang:1.24-alpine AS build

WORKDIR /src
COPY services/match-service-go/go.mod ./
RUN go mod download

COPY services/match-service-go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/match-service ./cmd/server

FROM alpine:3.21

RUN adduser -D -H -s /sbin/nologin app
USER app

COPY --from=build /out/match-service /usr/local/bin/match-service

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/match-service"]
