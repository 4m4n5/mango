import type { Stream } from './core.js';

export type ParsedFormatterFields = {
  resolution?: string;
  release_tier?: string;
  release_group?: string;
  encode?: string;
  size_gb?: number;
  indexer?: string;
  hdr_tags?: string[];
  languages: string[];
};

const LANGUAGE_TOKENS: Array<{ pattern: RegExp; language: string }> = [
  { pattern: /🇬🇧|\beng(?:lish)?\b/i, language: 'English' },
  { pattern: /🇮🇳|\bhindi\b|हिंदी/i, language: 'Hindi' },
  { pattern: /🇯🇵/, language: 'Japanese' },
  { pattern: /🇰🇷/, language: 'Korean' },
  { pattern: /🇫🇷|\bfrench\b|\bfre\b/i, language: 'French' },
  { pattern: /🇩🇪|\bgerman\b|\bger\b/i, language: 'German' },
  { pattern: /🇪🇸|\bspanish\b|\bspa\b/i, language: 'Spanish' },
  { pattern: /🇮🇹|\bitalian\b|\bita\b/i, language: 'Italian' },
  { pattern: /🇵🇹|🇧🇷|\bportuguese\b|\bpor\b|\bpt[-\s]?br\b/i, language: 'Portuguese' },
  { pattern: /🇷🇺|\brussian\b|\brus\b/i, language: 'Russian' },
  { pattern: /🇸🇦|\barabic\b|\bara\b/i, language: 'Arabic' },
  { pattern: /\btamil\b/i, language: 'Tamil' },
  { pattern: /\btelugu\b/i, language: 'Telugu' },
  { pattern: /\bmalayalam\b/i, language: 'Malayalam' },
  { pattern: /\bkannada\b/i, language: 'Kannada' },
  { pattern: /\bbengali\b/i, language: 'Bengali' },
  { pattern: /\bpunjabi\b/i, language: 'Punjabi' },
  { pattern: /\bmarathi\b/i, language: 'Marathi' },
];

const RELEASE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bblu[\s-]?ray\b/i, label: 'BluRay' },
  { pattern: /\bweb[\s-]?dl\b/i, label: 'WEB-DL' },
  { pattern: /\bweb[\s-]?rip\b/i, label: 'WEBRip' },
  { pattern: /\bremux\b/i, label: 'REMUX' },
  { pattern: /\bbd[\s-]?rip\b|\bbdrip\b/i, label: 'BDRip' },
  { pattern: /\bhdtv\b/i, label: 'HDTV' },
  { pattern: /\bdvd[\s-]?rip\b|\bdvdrip\b/i, label: 'DVDRip' },
];

const ENCODE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bhevc\b|\bh\.?265\b|\bx265\b/i, label: 'HEVC' },
  { pattern: /\bavc\b|\bh\.?264\b|\bx264\b/i, label: 'AVC' },
  { pattern: /\bav1\b/i, label: 'AV1' },
];

const HDR_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bhdr10\+\b/i, label: 'HDR10+' },
  { pattern: /\bhdr10\b/i, label: 'HDR10' },
  { pattern: /\bdolby\s+vision\b|\bdv\b/i, label: 'DV' },
  { pattern: /\bhdr\b/i, label: 'HDR' },
  { pattern: /\bhlg\b/i, label: 'HLG' },
];

function addUnique(items: string[], value: string | undefined): void {
  if (!value) return;
  if (!items.some((item) => item.toLowerCase() === value.toLowerCase())) {
    items.push(value);
  }
}

function markerValue(line: string, marker: string): string | undefined {
  const start = line.indexOf(marker);
  if (start < 0) return undefined;
  const rest = line.slice(start + marker.length);
  const stop = rest.search(/[📁🎥🎞🏷📺🎧🔊📦⏱🔍🌐📝]/u);
  const value = (stop >= 0 ? rest.slice(0, stop) : rest)
    .replace(/[•·|]+/g, ' ')
    .trim();
  return value || undefined;
}

function firstRelease(text: string): string | undefined {
  return RELEASE_PATTERNS.find((item) => item.pattern.test(text))?.label;
}

function firstEncode(text: string): string | undefined {
  return ENCODE_PATTERNS.find((item) => item.pattern.test(text))?.label;
}

function hdrTags(text: string): string[] {
  const tags: string[] = [];
  for (const item of HDR_PATTERNS) {
    if (item.pattern.test(text)) addUnique(tags, item.label);
  }
  return tags;
}

export function textWithoutSubtitleLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*subtitles?\s*:/i.test(line.trim()))
    .join('\n');
}

function languagesFromText(text: string): string[] {
  const languages: string[] = [];
  const parts = text.split(/[\/,;|]+|\s{2,}/);
  for (const part of parts.length > 1 ? parts : [text]) {
    for (const item of LANGUAGE_TOKENS) {
      if (item.pattern.test(part)) addUnique(languages, item.language);
    }
  }
  return languages;
}

function parseSizeGb(text: string): number | undefined {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(gb|gib|mb|mib)\b/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2]?.toLowerCase() || 'gb';
  const gb = unit.startsWith('m') ? amount / 1024 : amount;
  return Math.round(gb * 100) / 100;
}

function parseResolution(text: string): string | undefined {
  const match = text.match(/\b(2160p|4k|1440p|1080p|720p|576p|480p)\b/i);
  if (!match) return undefined;
  const raw = match[1].toLowerCase();
  return raw === '4k' ? '2160p' : raw;
}

function parseReleaseGroup(text: string): string | undefined {
  const explicit = text.match(/\b(?:group|release\s*group|rg)\s*[:=-]\s*([A-Z0-9][A-Z0-9._-]{1,20})\b/i);
  if (explicit?.[1]) return explicit[1].replace(/[._-]+$/g, '');
  const hyphen = text.match(/(?:^|[\s.\[])-\s*([A-Z0-9][A-Z0-9._-]{1,20})(?:\]|\s|$)/);
  if (hyphen?.[1]) return hyphen[1].replace(/[._-]+$/g, '');
  const trailing = text.match(/[-_.]([A-Z0-9][A-Z0-9._]{1,20})(?:\s+\d+(?:\.\d+)?\s*(?:gb|gib|mb|mib)\b|\s*$)/i);
  return trailing?.[1]?.replace(/[._-]+$/g, '');
}

function mergeFields(base: ParsedFormatterFields, extra: Partial<ParsedFormatterFields>): void {
  base.resolution ??= extra.resolution;
  base.release_tier ??= extra.release_tier;
  base.release_group ??= extra.release_group;
  base.encode ??= extra.encode;
  base.size_gb ??= extra.size_gb;
  base.indexer ??= extra.indexer;
  if (extra.hdr_tags) {
    for (const tag of extra.hdr_tags) addUnique(base.hdr_tags ??= [], tag);
  }
  if (extra.languages) {
    for (const language of extra.languages) addUnique(base.languages, language);
  }
}

export function parseFormatterDescription(description: string): ParsedFormatterFields {
  const fields: ParsedFormatterFields = { languages: [] };
  const text = description || '';

  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const releaseValue = markerValue(line, '🎥');
    if (releaseValue) fields.release_tier ??= firstRelease(releaseValue);

    const encodeValue = markerValue(line, '🎞️') ?? markerValue(line, '🎞');
    if (encodeValue) fields.encode ??= firstEncode(encodeValue);

    const groupValue = markerValue(line, '🏷️') ?? markerValue(line, '🏷');
    if (groupValue) fields.release_group ??= groupValue.split(/\s+/)[0]?.replace(/[^\w.-]/g, '');

    const visualValue = markerValue(line, '📺');
    if (visualValue) {
      for (const tag of hdrTags(visualValue)) addUnique(fields.hdr_tags ??= [], tag);
    }

    const sizeValue = markerValue(line, '📦');
    if (sizeValue) fields.size_gb ??= parseSizeGb(sizeValue);

    const indexerValue = markerValue(line, '🔍');
    if (indexerValue) fields.indexer ??= indexerValue.split(/[•·|]/)[0]?.trim();

    const languageValue = markerValue(line, '🌐');
    if (languageValue) {
      for (const language of languagesFromText(languageValue)) addUnique(fields.languages, language);
    }
    const notesValue = markerValue(line, '📝');
    if (notesValue) {
      for (const language of languagesFromText(notesValue)) addUnique(fields.languages, language);
    }
  }

  mergeFields(fields, {
    resolution: parseResolution(text),
    release_tier: firstRelease(text),
    release_group: parseReleaseGroup(text),
    encode: firstEncode(text),
    size_gb: parseSizeGb(text),
    hdr_tags: hdrTags(text),
  });

  if (fields.languages.length === 0) {
    for (const language of languagesFromText(textWithoutSubtitleLines(text))) {
      addUnique(fields.languages, language);
    }
  }

  return fields;
}

function stringField(stream: Stream, field: string): string | undefined {
  const value = stream[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function numberField(stream: Stream, field: string): number | undefined {
  const value = stream[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatSizeGb(value: number): string {
  if (value >= 2) return `${Math.max(1, Math.round(value))} GB`;
  return `${Number(value.toFixed(1))} GB`;
}

function compactSegment(parts: Array<string | undefined>): string | undefined {
  const text = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

export function buildDisplayLabel(fields: ParsedFormatterFields, stream: Stream): string {
  const resolution = fields.resolution ?? stringField(stream, 'resolution') ?? stringField(stream, 'quality');
  const releaseTier = fields.release_tier ?? stringField(stream, 'release_tier');
  const encode = fields.encode ?? stringField(stream, 'encode');
  const releaseGroup = fields.release_group ?? stringField(stream, 'release_group');
  const size = fields.size_gb ?? numberField(stream, 'size_gb');
  const main = compactSegment([resolution, releaseTier, encode]);
  const segments = [
    main,
    releaseGroup,
    size !== undefined ? formatSizeGb(size) : undefined,
  ].filter((item): item is string => Boolean(item));
  const label = segments.join(' · ').replace(/\s+/g, ' ').trim();
  if (label) return label;
  return stringField(stream, 'name') ?? stringField(stream, 'title') ?? 'stream';
}
