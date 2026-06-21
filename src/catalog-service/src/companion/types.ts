export type FamiliarityStage = 'stranger' | 'regular' | 'friend';

export type TitleRef = {
  type: string;
  id: string;
  title?: string;
};

export type CompanionProfile = {
  version: number;
  updated_at: string;
  familiarity: {
    stage: FamiliarityStage;
    score: number;
    sessions: number;
    completed_watches: number;
  };
  identity: {
    languages: string[];
    reply_style: string;
  };
  taste: {
    loves: string[];
    avoids: string[];
    title_loves: TitleRef[];
    title_avoids: TitleRef[];
    mood_defaults: {
      weeknight: string | null;
      weekend: string | null;
    };
  };
  facts: string[];
  open_questions: string[];
  behavior: {
    proactive_opt_in: boolean;
  };
  session_notes?: string[];
};

export const TITLE_LOVES_CAP = 50;
export const SESSION_NOTE_BULLETS_MAX = 5;
export const REGULAR_SESSIONS = 5;
export const FRIEND_SESSIONS = 20;
export const FRIEND_COMPLETED_WATCHES = 5;

export function defaultProfile(): CompanionProfile {
  return {
    version: 2,
    updated_at: new Date().toISOString(),
    familiarity: {
      stage: 'stranger',
      score: 0,
      sessions: 0,
      completed_watches: 0,
    },
    identity: {
      languages: ['hinglish'],
      reply_style: 'contextual',
    },
    taste: {
      loves: [],
      avoids: [],
      title_loves: [],
      title_avoids: [],
      mood_defaults: { weeknight: null, weekend: null },
    },
    facts: [],
    open_questions: [],
    behavior: { proactive_opt_in: false },
    session_notes: [],
  };
}
