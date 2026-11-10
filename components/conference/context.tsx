'use client';
import { createContext, useContext } from 'react';

export type Conn = { token: string; url: string; role: string; moderator: boolean };
export type RoomOpts = {
  sessionId: string; title: string; recording: boolean; chatEnabled: boolean; orgId: string; sectionId: string | null;
  /** Invitado externo (sin cuenta): sin adjuntos ni grabación. */
  guest?: boolean;
};
export type ConferenceControl = {
  active: { conn: Conn; opts: RoomOpts } | null;
  minimized: boolean;
  error: string | null;
  join: (conn: Conn, opts: RoomOpts) => void;
  leave: () => void;
  setMinimized: (v: boolean) => void;
};
export const ConferenceContext = createContext<ConferenceControl | null>(null);
export const useConference = () => useContext(ConferenceContext);
