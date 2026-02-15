/**
 * Global Audio Manager — Singleton
 *
 * Ensures only ONE voice plays at a time across the entire app.
 * When a new player starts, the previous one is automatically stopped.
 *
 * Also tracks pause position per text-hash so resume works.
 */

type StopCallback = () => void;

class AudioManager {
    private activeId: string | null = null;
    private stopFn: StopCallback | null = null;

    /** Register as the active player. Stops any previous player. */
    acquire(id: string, onStop: StopCallback): void {
        // Stop previous player if different
        if (this.activeId && this.activeId !== id && this.stopFn) {
            this.stopFn();
        }
        this.activeId = id;
        this.stopFn = onStop;
    }

    /** Release ownership (called when player stops itself) */
    release(id: string): void {
        if (this.activeId === id) {
            this.activeId = null;
            this.stopFn = null;
        }
    }

    /** Check if this id is currently the active player */
    isActive(id: string): boolean {
        return this.activeId === id;
    }

    /** Get current active player id */
    getActive(): string | null {
        return this.activeId;
    }
}

/** Singleton — one manager for the whole app */
export const audioManager = new AudioManager();
