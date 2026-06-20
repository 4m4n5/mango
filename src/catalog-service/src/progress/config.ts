/** Min fraction watched before Continue rail (5%). */
export const PROGRESS_CONTINUE_MIN = 0.05;

/** Max fraction — at/above this, title is finished and dropped from Continue (90%). */
export const PROGRESS_CONTINUE_MAX = 0.90;

/** mpv position poll interval while playing. */
export const PROGRESS_POLL_MS = 30_000;

/** Max Continue posters per home tab. */
export const PROGRESS_CONTINUE_LIMIT = 12;

export const CONTINUE_RAIL_ID = 'continue-watching';

export const DEFAULT_PROGRESS_DB_PATH = '/etc/mango/progress.db';
