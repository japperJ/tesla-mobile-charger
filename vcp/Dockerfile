FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git
RUN git clone --depth=1 https://github.com/teslamotors/vehicle-command.git /src
WORKDIR /src
RUN go build -o /usr/local/bin/tesla-http-proxy ./cmd/tesla-http-proxy

FROM alpine:latest
RUN apk add --no-cache ca-certificates openssl
# Self-signed TLS cert for the proxy listener (Docker-internal only)
RUN mkdir -p /etc/tesla && \
    openssl req -x509 -newkey rsa:2048 \
      -keyout /etc/tesla/tls.key \
      -out /etc/tesla/tls.cert \
      -days 3650 -nodes -subj '/CN=vcp'
COPY --from=builder /usr/local/bin/tesla-http-proxy /usr/local/bin/tesla-http-proxy
EXPOSE 4040
ENTRYPOINT ["tesla-http-proxy"]
