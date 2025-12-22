package utils

import (
	"sync"
	"time"
)

type RateLimitedQueue struct {
	mu         sync.Mutex
	queue      []func()
	processing bool
	intervalMs int
}

func NewRateLimitedQueue(qps int) *RateLimitedQueue {
	return &RateLimitedQueue{
		intervalMs: 1000 / qps,
	}
}

func (q *RateLimitedQueue) Enqueue(fn func()) {
	q.mu.Lock()
	q.queue = append(q.queue, fn)
	q.mu.Unlock()
	go q.processQueue()
}

func (q *RateLimitedQueue) processQueue() {
	q.mu.Lock()
	if q.processing {
		q.mu.Unlock()
		return
	}
	q.processing = true
	q.mu.Unlock()

	for {
		q.mu.Lock()
		if len(q.queue) == 0 {
			q.processing = false
			q.mu.Unlock()
			return
		}
		task := q.queue[0]
		q.queue = q.queue[1:]
		q.mu.Unlock()

		task()
		time.Sleep(time.Duration(q.intervalMs) * time.Millisecond)
	}
}
