// Command dbinit creates the MongoDB indexes. It is run by hand (or by deploy/dbinit.sh) when the
// schema changes, never as part of a routine API restart. It is idempotent.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

func main() {
	uri, db := os.Getenv("MONGO_URI"), os.Getenv("MONGO_DB")
	if db == "" {
		db = "bubbles"
	}
	if uri == "" {
		fmt.Fprintln(os.Stderr, "MONGO_URI is required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	m, err := store.ConnectMongo(ctx, uri, db)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		os.Exit(1)
	}
	defer m.Close(context.Background())
	if err := m.EnsureIndexes(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("indexes ok")
}
