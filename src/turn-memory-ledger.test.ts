import { describe, expect, it } from "vitest";
import { TurnMemoryLedger } from "./turn-memory-ledger.ts";

describe("TurnMemoryLedger", () => {
  it("starts with empty state and version 0", () => {
    const ledger = new TurnMemoryLedger();
    expect(ledger.autoInjected.size).toBe(0);
    expect(ledger.searchResults.size).toBe(0);
    expect(ledger.explicitlyOpened.size).toBe(0);
    expect(ledger.storedThisTurn.size).toBe(0);
    expect(ledger.version).toBe(0);
  });

  describe("addAutoInjected", () => {
    it("tracks auto-injected memory with score", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addAutoInjected("mem1", 0.85);
      expect(ledger.autoInjected.get("mem1")).toEqual({ score: 0.85 });
    });

    it("does not increment version (not tool-visible, should not invalidate cache)", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addAutoInjected("mem1", 0.9);
      expect(ledger.version).toBe(0);
    });

    it("overwrites previous score for same id", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addAutoInjected("mem1", 0.5);
      ledger.addAutoInjected("mem1", 0.9);
      expect(ledger.autoInjected.get("mem1")).toEqual({ score: 0.9 });
      expect(ledger.version).toBe(0);
    });
  });

  describe("addSearchResults", () => {
    it("tracks search results with score and query", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addSearchResults([
        { id: "mem1", score: 0.9, query: "database" },
        { id: "mem2", score: 0.7, query: "database" },
      ]);
      expect(ledger.searchResults.get("mem1")).toEqual({ score: 0.9, query: "database" });
      expect(ledger.searchResults.get("mem2")).toEqual({ score: 0.7, query: "database" });
    });

    it("increments version once per batch", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addSearchResults([
        { id: "mem1", score: 0.9, query: "q" },
        { id: "mem2", score: 0.8, query: "q" },
      ]);
      expect(ledger.version).toBe(1);
    });

    it("does not increment version for empty batch", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addSearchResults([]);
      expect(ledger.version).toBe(0);
    });

    it("does not increment version for duplicate IDs", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addSearchResults([{ id: "mem1", score: 0.9, query: "q" }]);
      expect(ledger.version).toBe(1);
      ledger.addSearchResults([{ id: "mem1", score: 0.95, query: "q2" }]);
      expect(ledger.version).toBe(1); // same ID, no version bump
    });
  });

  describe("addExplicitlyOpened", () => {
    it("tracks get-by-id access", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addExplicitlyOpened("mem1");
      expect(ledger.explicitlyOpened.has("mem1")).toBe(true);
    });

    it("increments version on first add", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addExplicitlyOpened("mem1");
      expect(ledger.version).toBe(1);
    });

    it("does not increment version for duplicate ID", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addExplicitlyOpened("mem1");
      ledger.addExplicitlyOpened("mem1");
      expect(ledger.version).toBe(1);
    });
  });

  describe("addStoredThisTurn", () => {
    it("tracks newly stored memory", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addStoredThisTurn("mem1");
      expect(ledger.storedThisTurn.has("mem1")).toBe(true);
    });

    it("increments version on first add", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addStoredThisTurn("mem1");
      expect(ledger.version).toBe(1);
    });

    it("does not increment version for duplicate ID", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addStoredThisTurn("mem1");
      ledger.addStoredThisTurn("mem1");
      expect(ledger.version).toBe(1);
    });
  });

  describe("isExposedViaTools", () => {
    it("returns false for unknown id", () => {
      const ledger = new TurnMemoryLedger();
      expect(ledger.isExposedViaTools("unknown")).toBe(false);
    });

    it("returns false for auto-injected only (not tool-visible)", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addAutoInjected("mem1", 0.9);
      expect(ledger.isExposedViaTools("mem1")).toBe(false);
    });

    it("returns true for search result", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addSearchResults([{ id: "mem1", score: 0.9, query: "q" }]);
      expect(ledger.isExposedViaTools("mem1")).toBe(true);
    });

    it("returns true for explicitly opened", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addExplicitlyOpened("mem1");
      expect(ledger.isExposedViaTools("mem1")).toBe(true);
    });

    it("returns true for stored this turn", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addStoredThisTurn("mem1");
      expect(ledger.isExposedViaTools("mem1")).toBe(true);
    });
  });

  describe("reset", () => {
    it("clears all state and resets version to 0", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addAutoInjected("a", 0.9);
      ledger.addSearchResults([{ id: "b", score: 0.8, query: "q" }]);
      ledger.addExplicitlyOpened("c");
      ledger.addStoredThisTurn("d");
      expect(ledger.version).toBe(3); // autoInjected does not bump version

      ledger.reset();

      expect(ledger.autoInjected.size).toBe(0);
      expect(ledger.searchResults.size).toBe(0);
      expect(ledger.explicitlyOpened.size).toBe(0);
      expect(ledger.storedThisTurn.size).toBe(0);
      expect(ledger.version).toBe(0);
    });
  });

  describe("version tracking across operations", () => {
    it("accumulates version only for tool-visible mutations", () => {
      const ledger = new TurnMemoryLedger();
      ledger.addAutoInjected("a", 0.9);     // v=0 (no bump)
      ledger.addSearchResults([{ id: "b", score: 0.8, query: "q" }]); // v=1
      ledger.addExplicitlyOpened("c");       // v=2
      ledger.addStoredThisTurn("d");         // v=3
      expect(ledger.version).toBe(3);
    });
  });
});
