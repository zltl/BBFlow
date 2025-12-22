.PHONY: build run dev clean test fmt lint tidy docker-build docker-run

# Binary name
BINARY_NAME=bbflow-server

# Go parameters
GOCMD=go
GOBUILD=$(GOCMD) build
GORUN=$(GOCMD) run
GOTEST=$(GOCMD) test
GOFMT=$(GOCMD) fmt
GOMOD=$(GOCMD) mod

# Build flags
BUILD_FLAGS=-ldflags="-s -w"

# Build the application
build:
	$(GOBUILD) $(BUILD_FLAGS) -o $(BINARY_NAME) .

# Run the application
run: build
	./$(BINARY_NAME)

# Run in development mode
dev:
	$(GORUN) main.go

# Clean build artifacts
clean:
	rm -f $(BINARY_NAME)
	$(GOCMD) clean

# Run tests
test:
	$(GOTEST) -v ./...

# Format code
fmt:
	$(GOFMT) ./...

# Lint code (requires golangci-lint)
lint:
	golangci-lint run

# Tidy dependencies
tidy:
	$(GOMOD) tidy

# Build for Linux (cross-compile)
build-linux:
	GOOS=linux GOARCH=amd64 $(GOBUILD) $(BUILD_FLAGS) -o $(BINARY_NAME)-linux-amd64 .

# Build for macOS
build-darwin:
	GOOS=darwin GOARCH=amd64 $(GOBUILD) $(BUILD_FLAGS) -o $(BINARY_NAME)-darwin-amd64 .
	GOOS=darwin GOARCH=arm64 $(GOBUILD) $(BUILD_FLAGS) -o $(BINARY_NAME)-darwin-arm64 .

# Build for Windows
build-windows:
	GOOS=windows GOARCH=amd64 $(GOBUILD) $(BUILD_FLAGS) -o $(BINARY_NAME)-windows-amd64.exe .

# Build all platforms
build-all: build-linux build-darwin build-windows

# Docker build
docker-build:
	docker build -t bbflow-server .

# Docker run
docker-run:
	docker run -p 3000:3000 --env-file ../.secret.dev bbflow-server

# Install dependencies
deps:
	$(GOMOD) download
	$(GOMOD) tidy

# Show help
help:
	@echo "Available targets:"
	@echo "  build        - Build the application"
	@echo "  run          - Build and run the application"
	@echo "  dev          - Run in development mode"
	@echo "  clean        - Clean build artifacts"
	@echo "  test         - Run tests"
	@echo "  fmt          - Format code"
	@echo "  lint         - Lint code (requires golangci-lint)"
	@echo "  tidy         - Tidy dependencies"
	@echo "  build-linux  - Cross-compile for Linux"
	@echo "  build-darwin - Cross-compile for macOS"
	@echo "  build-windows- Cross-compile for Windows"
	@echo "  build-all    - Build for all platforms"
	@echo "  docker-build - Build Docker image"
	@echo "  docker-run   - Run Docker container"
	@echo "  deps         - Install dependencies"
