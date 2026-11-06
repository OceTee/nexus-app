import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import { Check, Square } from 'lucide-react-native';
import { Fragment, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type TextStyle } from 'react-native';
import { AttachmentImage } from '@/features/attachments/AttachmentImage';
import { alpha, Text, useTheme, type Theme } from '@/ui';

const ATTACHMENT = /^nexus:\/\/attachment\/([0-9a-f-]{36})$/i;

/** Attachment id from a `nexus://attachment/<id>` URL. */
export function attachmentIdOf(href: string): string | null {
  return ATTACHMENT.exec(href)?.[1] ?? null;
}

const openAttachment = (attachmentId: string) =>
  router.push({ pathname: '/attachment/[attachmentId]', params: { attachmentId } });

const openHref = (href: string) => {
  const id = attachmentIdOf(href);
  if (id) openAttachment(id);
  else void WebBrowser.openBrowserAsync(href);
};

/** Inline token for `[[Target]]` and `[[Target|alias]]`. */
interface WikiLinkToken {
  type: 'wikilink';
  raw: string;
  target: string;
  display: string;
}

const wikiLink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => {
    const i = src.indexOf('[[');
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m = /^\[\[([^\][\n|]+)(?:\|([^\][\n]+))?\]\]/.exec(src);
    if (!m) return undefined;
    const target = m[1]!.trim();
    return { type: 'wikilink', raw: m[0], target, display: (m[2] ?? m[1]!).trim() || target };
  },
  renderer: () => '',
};

const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({ extensions: [wikiLink] });

export interface PreviewProps {
  body: string;
  /** Reading mode: serif body and a wider measure (S-09 "Read"). */
  reading?: boolean;
  onWikiLink: (target: string) => void;
  /** Titles that resolve to a live note; unresolved links render as ghost links. */
  resolved?: ReadonlySet<string>;
  normalise?: (title: string) => string;
  footer?: ReactNode;
}

/**
 * MarkdownPreview (S-09): renders CommonMark + GFM with wiki-links, code in
 * JetBrains Mono and simple tables. Built on marked's lexer so rendering is
 * native Text, not a WebView.
 */
export function MarkdownPreview(props: PreviewProps) {
  const t = useTheme();
  const tokens = useMemo(() => markdown.lexer(props.body), [props.body]);
  const ctx: Ctx = { t, props, base: props.reading ? t.type('bodySerif') : t.type('body') };
  return (
    <ScrollView
      contentContainerStyle={[styles.content, props.reading && styles.reading]}
      keyboardShouldPersistTaps="handled"
    >
      {tokens.length === 0 || !props.body.trim() ? (
        <Text variant="body" tone="inkFaint">
          Nothing to preview yet.
        </Text>
      ) : (
        tokens.map((tok, i) => <Block key={i} tok={tok} ctx={ctx} />)
      )}
      {props.footer}
    </ScrollView>
  );
}

interface Ctx {
  t: Theme;
  props: PreviewProps;
  base: TextStyle;
}

const HEADING = { 1: 'title1', 2: 'title2', 3: 'headline' } as const;

function Block({ tok, ctx }: { tok: Token; ctx: Ctx }): ReactNode {
  const { t } = ctx;
  switch (tok.type) {
    case 'space':
      return null;
    case 'heading': {
      const h = tok as Tokens.Heading;
      const variant = HEADING[h.depth as 1 | 2 | 3] ?? 'headline';
      return (
        <Text variant={variant} accessibilityRole="header" style={styles.heading}>
          <Inline tokens={h.tokens} ctx={ctx} />
        </Text>
      );
    }
    case 'paragraph': {
      const p = tok as Tokens.Paragraph;
      // An attachment image on its own line renders as a block image.
      const only = p.tokens.filter((x) => !(x.type === 'text' && !(x as Tokens.Text).text.trim()));
      if (only.length === 1 && only[0]!.type === 'image') {
        const id = attachmentIdOf((only[0] as Tokens.Image).href);
        if (id) return <AttachmentImage id={id} onPress={() => openAttachment(id)} />;
      }
      return (
        <Text style={[ctx.base, { color: t.colors.ink }, styles.para]}>
          <Inline tokens={p.tokens} ctx={ctx} />
        </Text>
      );
    }
    case 'text': {
      const tt = tok as Tokens.Text;
      return (
        <Text style={[ctx.base, { color: t.colors.ink }]}>
          {tt.tokens ? <Inline tokens={tt.tokens} ctx={ctx} /> : tt.text}
        </Text>
      );
    }
    case 'list': {
      const list = tok as Tokens.List;
      const start = typeof list.start === 'number' ? list.start : 1;
      return (
        <View style={styles.para}>
          {list.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <View style={styles.bullet}>
                {item.task ? (
                  item.checked ? (
                    <Check size={18} color={t.colors.primary} accessibilityLabel="Done" />
                  ) : (
                    <Square size={18} color={t.colors.inkSoft} accessibilityLabel="To do" />
                  )
                ) : (
                  <Text style={[ctx.base, { color: t.colors.inkSoft }]}>
                    {list.ordered ? `${start + i}.` : '•'}
                  </Text>
                )}
              </View>
              <View style={styles.flex}>
                {item.tokens.map((child, j) => (
                  <Block key={j} tok={child} ctx={ctx} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'code':
      return (
        <ScrollView
          horizontal
          style={[styles.codeBlock, { backgroundColor: t.colors.codeBackground }]}
          contentContainerStyle={styles.codeInner}
        >
          <Text style={[t.type('mono'), { color: t.colors.ink }]} selectable>
            {(tok as Tokens.Code).text}
          </Text>
        </ScrollView>
      );
    case 'blockquote':
      return (
        <View style={[styles.quote, { borderLeftColor: t.colors.line }]}>
          {(tok as Tokens.Blockquote).tokens.map((child, i) => (
            <Block key={i} tok={child} ctx={ctx} />
          ))}
        </View>
      );
    case 'hr':
      return <View style={[styles.hr, { backgroundColor: t.colors.line }]} />;
    case 'table': {
      const table = tok as Tokens.Table;
      const cell = (c: Tokens.TableCell, head: boolean, key: number) => (
        <View key={key} style={[styles.cell, { borderColor: t.colors.line }]}>
          <Text variant={head ? 'headline' : 'callout'}>
            <Inline tokens={c.tokens} ctx={ctx} />
          </Text>
        </View>
      );
      return (
        <ScrollView horizontal style={styles.para}>
          <View>
            <View style={[styles.tr, { backgroundColor: t.colors.surface2 }]}>
              {table.header.map((c, i) => cell(c, true, i))}
            </View>
            {table.rows.map((row, r) => (
              <View key={r} style={styles.tr}>
                {row.map((c, i) => cell(c, false, i))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    }
    case 'html':
      return (
        <Text style={[t.type('mono'), { color: t.colors.inkSoft }]}>
          {(tok as Tokens.HTML).text}
        </Text>
      );
    default:
      return 'raw' in tok && typeof tok.raw === 'string' ? (
        <Text style={[ctx.base, { color: t.colors.ink }]}>{tok.raw}</Text>
      ) : null;
  }
}

function Inline({ tokens, ctx }: { tokens: Token[] | undefined; ctx: Ctx }): ReactNode {
  const { t, props } = ctx;
  if (!tokens) return null;
  return tokens.map((tok, i) => {
    switch (tok.type) {
      case 'text': {
        const tt = tok as Tokens.Text;
        return tt.tokens ? (
          <Inline key={i} tokens={tt.tokens} ctx={ctx} />
        ) : (
          <Fragment key={i}>{decode(tt.text)}</Fragment>
        );
      }
      case 'escape':
        return <Fragment key={i}>{(tok as Tokens.Escape).text}</Fragment>;
      case 'strong':
        return (
          <Text key={i} style={styles.bold}>
            <Inline tokens={(tok as Tokens.Strong).tokens} ctx={ctx} />
          </Text>
        );
      case 'em':
        return (
          <Text key={i} style={styles.italic}>
            <Inline tokens={(tok as Tokens.Em).tokens} ctx={ctx} />
          </Text>
        );
      case 'del':
        return (
          <Text key={i} style={styles.strike}>
            <Inline tokens={(tok as Tokens.Del).tokens} ctx={ctx} />
          </Text>
        );
      case 'codespan':
        return (
          <Text
            key={i}
            style={[
              t.type('mono'),
              { color: t.colors.ink, backgroundColor: t.colors.codeBackground },
            ]}
          >
            {decode((tok as Tokens.Codespan).text)}
          </Text>
        );
      case 'br':
        return <Fragment key={i}>{'\n'}</Fragment>;
      case 'link': {
        const link = tok as Tokens.Link;
        return (
          <Text
            key={i}
            accessibilityRole="link"
            onPress={() => openHref(link.href)}
            style={[styles.link, { color: t.colors.primary }]}
          >
            <Inline tokens={link.tokens} ctx={ctx} />
          </Text>
        );
      }
      case 'image': {
        const img = tok as Tokens.Image;
        const id = attachmentIdOf(img.href);
        return (
          <Text
            key={i}
            accessibilityRole={id ? 'link' : 'text'}
            onPress={id ? () => openAttachment(id) : undefined}
            style={{ color: id ? t.colors.primary : t.colors.inkSoft }}
          >
            {`📎 ${img.text || 'image'}`}
          </Text>
        );
      }
      case 'wikilink': {
        const w = tok as unknown as WikiLinkToken;
        const known = props.resolved?.has(props.normalise?.(w.target) ?? w.target) ?? true;
        return (
          <Text
            key={i}
            accessibilityRole="link"
            accessibilityHint={known ? 'Opens the linked note' : 'No note has this title yet'}
            onPress={() => props.onWikiLink(w.target)}
            style={[
              styles.wiki,
              known
                ? { color: t.colors.primary, backgroundColor: alpha(t.colors.primary, 0.08) }
                : { color: t.colors.inkSoft, textDecorationStyle: 'dashed' },
            ]}
          >
            {w.display}
          </Text>
        );
      }
      default:
        return 'raw' in tok && typeof tok.raw === 'string' ? (
          <Fragment key={i}>{tok.raw}</Fragment>
        ) : null;
    }
  });
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e);

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 120 },
  reading: { paddingHorizontal: 24 },
  heading: { marginTop: 16, marginBottom: 8 },
  para: { marginBottom: 12 },
  listItem: { flexDirection: 'row', marginBottom: 4 },
  bullet: { width: 28, alignItems: 'flex-start', paddingTop: 3 },
  flex: { flex: 1 },
  codeBlock: { borderRadius: 10, marginBottom: 12 },
  codeInner: { padding: 12 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 12 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 16 },
  tr: { flexDirection: 'row' },
  cell: { minWidth: 96, padding: 8, borderWidth: StyleSheet.hairlineWidth },
  bold: { fontFamily: 'Inter-SemiBold' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  wiki: { textDecorationLine: 'underline' },
});
