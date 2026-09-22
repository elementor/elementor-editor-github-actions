IMG ?= ghcr.io/elementor/ephemeral-operator:0.1.0

.PHONY: tidy test build build-cli docker-build manifests fmt vet

tidy:
	go mod tidy

fmt:
	go fmt ./...

vet:
	go vet ./...

test: fmt vet
	go test ./...

build:
	CGO_ENABLED=0 go build -o bin/manager ./cmd/manager
	CGO_ENABLED=0 go build -o bin/ephem ./cmd/ephem

build-cli:
	CGO_ENABLED=0 go build -o bin/ephem ./cmd/ephem

docker-build:
	docker build -t $(IMG) .

manifests:
	@echo "CRDs live in config/crd/bases (hand-maintained for v1)"
	@ls config/crd/bases
