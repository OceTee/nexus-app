// Demo corpus behind the portfolio screenshots (TDD Section E, Seed data
// strategy): one user and device, 3 nested collections, 12 tags, 60 notes
// whose wiki-links form three clusters plus two orphans, 8 attachments
// (metadata only) and 200 versions. Pure data: no database access here.

import { createHash } from 'node:crypto';
import { excerpt, stripMarkdown, uniqueLinkTargets, wordCount } from '@nexus/shared';
import { v7 as uuidv7 } from 'uuid';

export const DEMO_EMAIL = 'demo@nexus.example';
export const DEMO_DISPLAY_NAME = 'Amara (demo)';

interface ClusterSpec {
  hub: string;
  members: string[];
  tags: string[];
  topic: string;
}

/** Three clusters of 20, 19 and 19 notes (58) plus two orphans = 60 notes. */
const CLUSTERS: ClusterSpec[] = [
  {
    hub: 'State estimation',
    topic: 'estimating the hidden state of a dynamic system from noisy measurements',
    tags: ['thesis', 'methods', 'reading'],
    members: [
      'Kalman filtering',
      'Extended Kalman filter',
      'Unscented Kalman filter',
      'Particle filters',
      'Sensor fusion',
      'Bayesian inference',
      'Covariance matrices',
      'Process noise',
      'Measurement noise',
      'Observability',
      'Dead reckoning',
      'IMU calibration',
      'GPS integration',
      'Smoothing vs filtering',
      'Rauch-Tung-Striebel smoother',
      'Innovation sequence',
      'Filter tuning',
      'Thesis chapter 2 outline',
      'Literature map',
    ],
  },
  {
    hub: 'Learning science',
    topic: 'how people learn and remember, applied to studying',
    tags: ['ideas', 'exam', 'reading'],
    members: [
      'Spaced repetition',
      'Retrieval practice',
      'Interleaving',
      'Exam planning',
      'Forgetting curve',
      'Desirable difficulties',
      'Elaborative interrogation',
      'Dual coding',
      'Cognitive load',
      'Worked examples',
      'Note-taking methods',
      'Zettelkasten',
      'Active recall cards',
      'Study schedule',
      'Sleep and memory',
      'Metacognition',
      'Feedback loops',
      'Weekly review',
    ],
  },
  {
    hub: 'Platform operations',
    topic: 'keeping production systems healthy',
    tags: ['runbook', 'postgres', 'incident'],
    members: [
      'Postgres runbook',
      'Connection pooling',
      'Vacuum and bloat',
      'Index tuning',
      'Backup and restore drill',
      'Point-in-time recovery',
      'Incident 2026-10-14',
      'Incident review template',
      'On-call checklist',
      'Rate limiting',
      'Deploy checklist',
      'Feature flags',
      'Error budgets',
      'Log retention',
      'Secrets rotation',
      'Load testing with k6',
      'Migrations without downtime',
      'Read replicas',
    ],
  },
];

const ORPHANS = ['Gift ideas', 'Recipe: jollof rice'];

export const DEMO_TAGS = [
  'thesis',
  'reading',
  'methods',
  'ideas',
  'todo',
  'exam',
  'meeting',
  'runbook',
  'postgres',
  'incident',
  'review',
  'archive',
] as const;

const TAG_COLOURS = ['#3B5BDB', '#E8A33D', '#1E7F4F', '#B91C1C', '#7048E8', '#0C8599'];

export interface DemoNote {
  id: string;
  title: string;
  bodyMd: string;
  bodyText: string;
  excerpt: string;
  wordCount: number;
  contentHash: string;
  collectionId: string | null;
  isPinned: boolean;
  serverRev: number;
  tagNames: string[];
  linkTargets: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DemoCorpus {
  device: { id: string; name: string; platform: 'android'; appVersion: string };
  collections: {
    id: string;
    parentId: string | null;
    name: string;
    icon: string;
    sortOrder: number;
  }[];
  tags: { id: string; name: string; colour: string }[];
  notes: DemoNote[];
  versions: {
    noteId: string;
    rev: number;
    baseRev: number;
    title: string;
    bodyMd: string;
    createdAt: string;
  }[];
  attachments: {
    id: string;
    noteTitle: string;
    filename: string;
    mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
    sizeBytes: number;
    width: number | null;
    height: number | null;
  }[];
}

export function contentHash(title: string, bodyMd: string): string {
  return createHash('sha256').update(`${title}\u0000${bodyMd}`).digest('hex');
}

/** Deterministic pseudo-random generator so the corpus is the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function body(title: string, cluster: ClusterSpec | null, links: string[], draft = 0): string {
  const intro = cluster
    ? `${title} is part of my notes on ${cluster.topic}.`
    : `${title}: a personal note kept outside the main projects.`;
  const linkLine = links.length
    ? `Related: ${links.map((l) => `[[${l}]]`).join(', ')}.`
    : 'No links yet.';
  const lines = [
    `# ${title}`,
    '',
    intro,
    '',
    '## Key points',
    '',
    '- What it is and why it matters',
    '- Where it fits with the neighbouring ideas',
    `- Open question ${draft > 0 ? `(draft ${draft})` : 'to revisit next week'}`,
    '',
    linkLine,
  ];
  if (title === 'Postgres runbook') {
    lines.push('', '```sql', 'SELECT pid, state, query FROM pg_stat_activity;', '```');
  }
  return lines.join('\n');
}

/** Builds the corpus relative to `now`, spreading edits over the previous 90 days. */
export function buildDemoCorpus(now: Date = new Date()): DemoCorpus {
  const rand = rng(20261104);
  const dayMs = 86_400_000;
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * dayMs).toISOString();

  const research = uuidv7();
  const thesis = uuidv7();
  const chapter = uuidv7();
  const collections = [
    { id: research, parentId: null, name: 'Research', icon: 'flask-conical', sortOrder: 0 },
    { id: thesis, parentId: research, name: 'Thesis', icon: 'book-open', sortOrder: 0 },
    { id: chapter, parentId: thesis, name: 'Chapter 2', icon: 'file-text', sortOrder: 0 },
  ];

  const tags = DEMO_TAGS.map((name, i) => ({
    id: uuidv7(),
    name,
    colour: TAG_COLOURS[i % TAG_COLOURS.length]!,
  }));

  const notes: DemoNote[] = [];
  const addNote = (
    title: string,
    cluster: ClusterSpec | null,
    links: string[],
    tagNames: string[],
    collectionId: string | null,
  ) => {
    const bodyMd = body(title, cluster, links);
    const created = 30 + Math.floor(rand() * 60);
    notes.push({
      id: uuidv7(),
      title,
      bodyMd,
      bodyText: stripMarkdown(bodyMd),
      excerpt: excerpt(bodyMd),
      wordCount: wordCount(bodyMd),
      contentHash: contentHash(title, bodyMd),
      collectionId,
      isPinned: false,
      serverRev: 1,
      tagNames,
      linkTargets: uniqueLinkTargets(bodyMd),
      createdAt: at(created),
      updatedAt: at(Math.floor(rand() * created)),
    });
  };

  CLUSTERS.forEach((cluster, ci) => {
    const titles = [cluster.hub, ...cluster.members];
    titles.forEach((title, i) => {
      // Hub links to its first members; members link to the hub and to neighbours.
      const links =
        i === 0
          ? cluster.members.slice(0, 4)
          : [
              cluster.hub,
              titles[(i % (titles.length - 1)) + 1]!,
              titles[((i + 3) % (titles.length - 1)) + 1]!,
            ].filter((t) => t !== title);
      const tagNames = [cluster.tags[i % cluster.tags.length]!];
      if (i % 5 === 0) tagNames.push('review');
      const collectionId = ci === 0 ? (i < 6 ? chapter : i < 12 ? thesis : research) : null;
      addNote(title, cluster, [...new Set(links)], tagNames, collectionId);
    });
  });
  ORPHANS.forEach((title) => addNote(title, null, [], ['todo'], null));

  // A ghost link: a note links to a title that does not exist yet.
  const outline = notes.find((n) => n.title === 'Thesis chapter 2 outline')!;
  outline.bodyMd += '\n\nTo write: [[Chapter 3 plan]].';
  Object.assign(outline, {
    bodyText: stripMarkdown(outline.bodyMd),
    excerpt: excerpt(outline.bodyMd),
    wordCount: wordCount(outline.bodyMd),
    contentHash: contentHash(outline.title, outline.bodyMd),
    linkTargets: uniqueLinkTargets(outline.bodyMd),
  });

  for (const title of ['State estimation', 'Exam planning', 'Postgres runbook']) {
    notes.find((n) => n.title === title)!.isPinned = true;
  }

  // 200 versions: the 40 most active notes each have 5 revisions.
  const versions: DemoCorpus['versions'] = [];
  for (const note of notes.slice(0, 40)) {
    note.serverRev = 5;
    const start = Date.parse(note.createdAt);
    const span = Date.parse(note.updatedAt) - start;
    for (let rev = 1; rev <= 5; rev++) {
      const bodyMd =
        rev === 5 ? note.bodyMd : `${note.bodyMd.split('\n## Key points')[0]}\n\nDraft ${rev}.`;
      versions.push({
        noteId: note.id,
        rev,
        baseRev: rev - 1,
        title: note.title,
        bodyMd,
        createdAt: new Date(start + (span * (rev - 1)) / 4).toISOString(),
      });
    }
  }

  const attachments: DemoCorpus['attachments'] = [
    {
      noteTitle: 'Kalman filtering',
      filename: 'whiteboard.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2_418_332,
      width: 3024,
      height: 4032,
    },
    {
      noteTitle: 'Sensor fusion',
      filename: 'imu-diagram.png',
      mimeType: 'image/png',
      sizeBytes: 184_221,
      width: 1600,
      height: 900,
    },
    {
      noteTitle: 'Particle filters',
      filename: 'thrun-2002.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_942_330,
      width: null,
      height: null,
    },
    {
      noteTitle: 'Literature map',
      filename: 'map-sketch.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1_204_118,
      width: 4032,
      height: 3024,
    },
    {
      noteTitle: 'Spaced repetition',
      filename: 'forgetting-curve.png',
      mimeType: 'image/png',
      sizeBytes: 96_410,
      width: 1200,
      height: 800,
    },
    {
      noteTitle: 'Exam planning',
      filename: 'timetable.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 312_904,
      width: null,
      height: null,
    },
    {
      noteTitle: 'Incident 2026-10-14',
      filename: 'grafana-panel.png',
      mimeType: 'image/png',
      sizeBytes: 402_777,
      width: 1920,
      height: 1080,
    },
    {
      noteTitle: 'Postgres runbook',
      filename: 'pg-architecture.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2_002_114,
      width: null,
      height: null,
    },
  ].map((a) => ({ ...a, id: uuidv7() })) as DemoCorpus['attachments'];

  return {
    device: { id: uuidv7(), name: 'Pixel 7 (demo)', platform: 'android', appVersion: '1.0.0' },
    collections,
    tags,
    notes,
    versions,
    attachments,
  };
}
