// "Play a friend" — a thin real-time layer on top of Firestore. Imported
// only via a dynamic import() from the controller, so the Firebase SDK is
// never downloaded by a player who never opens this mode.
//
// Model: one document per game at games/{gameId}. The creator is always
// White, whoever joins is Black; each browser gets a silent, no-password
// "anonymous" identity so the security rules can tell the two players
// apart without any sign-up. The document holds the *entire* move list —
// each local move overwrites it wholesale (not an append/arrayUnion, which
// would silently de-duplicate two plies that happen to share a from/to).
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth, type User } from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type { SavedMove } from '../core/persistence.ts';
import type { Color } from '../core/types.ts';
import { firebaseConfig } from './firebaseConfig.ts';

const GAME_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — easy to read aloud
const GAME_ID_LENGTH = 6;

interface GameDoc {
  players: { white: string | null; black: string | null };
  moves: SavedMove[];
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let authReadyPromise: Promise<User> | null = null;

/** Lazily initialises Firebase and signs in anonymously. Safe to call repeatedly. */
function ensureFirebase(): { auth: Auth; db: Firestore; authReady: Promise<User> } {
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
  if (!authReadyPromise) {
    const authInstance = auth!;
    authReadyPromise = new Promise<User>((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(
        authInstance,
        (user) => {
          unsubscribe();
          if (user) {
            resolve(user);
            return;
          }
          signInAnonymously(authInstance)
            .then((credential) => resolve(credential.user))
            .catch(reject);
        },
        reject,
      );
    }).catch((err: unknown) => {
      // Don't cache a failed attempt forever — a transient hiccup (or, as
      // happened once, clicking "Create" before Firebase had finished
      // propagating a console change) should be retryable without a reload.
      authReadyPromise = null;
      throw err;
    });
  }
  return { auth: auth!, db: db!, authReady: authReadyPromise };
}

function randomGameId(): string {
  let id = '';
  for (let i = 0; i < GAME_ID_LENGTH; i++) {
    id += GAME_ID_ALPHABET[Math.floor(Math.random() * GAME_ID_ALPHABET.length)];
  }
  return id;
}

function shareUrlFor(gameId: string): string {
  return `${location.origin}${location.pathname}?game=${gameId}`;
}

export interface MultiplayerSession {
  gameId: string;
  /** Which colour this browser is playing. */
  color: Color;
  shareUrl: string;
  /** The move list and seating as of the moment we connected — for an instant, unanimated catch-up. */
  initialMoves: SavedMove[];
  opponentJoined: boolean;
  /** Fires on every remote change: the full move list plus whether both seats are filled. */
  subscribe(onUpdate: (moves: SavedMove[], opponentJoined: boolean) => void): Unsubscribe;
  /** Overwrites the game's move list with the full history after a local move. */
  pushMoves(moves: SavedMove[]): Promise<void>;
}

function buildSession(gameId: string, color: Color, data: GameDoc): MultiplayerSession {
  const { db } = ensureFirebase();
  const ref = doc(db, 'games', gameId);
  return {
    gameId,
    color,
    shareUrl: shareUrlFor(gameId),
    initialMoves: data.moves ?? [],
    opponentJoined: !!data.players.white && !!data.players.black,
    subscribe(onUpdate) {
      return onSnapshot(ref, (snap) => {
        const snapData = snap.data() as GameDoc | undefined;
        if (!snapData) return;
        onUpdate(snapData.moves ?? [], !!snapData.players.white && !!snapData.players.black);
      });
    },
    async pushMoves(moves) {
      await updateDoc(ref, { moves, updatedAt: serverTimestamp() });
    },
  };
}

/** Starts a brand-new game. This browser becomes White. */
export async function createGame(): Promise<MultiplayerSession> {
  const { db, authReady } = ensureFirebase();
  const user = await authReady;
  const gameId = randomGameId();
  const data: GameDoc = { players: { white: user.uid, black: null }, moves: [] };
  await setDoc(doc(db, 'games', gameId), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return buildSession(gameId, 'white', data);
}

/** Joins an existing game by its code (or re-enters one this browser already has a seat in). */
export async function joinGame(gameId: string): Promise<MultiplayerSession> {
  const { db, authReady } = ensureFirebase();
  const user = await authReady;
  const ref = doc(db, 'games', gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That game code wasn't found — check it and try again.");
  const data = snap.data() as GameDoc;

  if (data.players.white === user.uid) return buildSession(gameId, 'white', data);
  if (data.players.black === user.uid) return buildSession(gameId, 'black', data);
  if (data.players.black) throw new Error('That game already has two players.');

  await updateDoc(ref, { 'players.black': user.uid, updatedAt: serverTimestamp() });
  return buildSession(gameId, 'black', { ...data, players: { ...data.players, black: user.uid } });
}

/** Reconnects to a game this browser was already seated in — used on reload. */
export async function rejoinGame(gameId: string, color: Color): Promise<MultiplayerSession> {
  const { db, authReady } = ensureFirebase();
  const user = await authReady;
  const ref = doc(db, 'games', gameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('That game no longer exists.');
  const data = snap.data() as GameDoc;
  const seatUid = color === 'white' ? data.players.white : data.players.black;
  if (seatUid !== user.uid) throw new Error('Could not reconnect to that game.');
  return buildSession(gameId, color, data);
}
