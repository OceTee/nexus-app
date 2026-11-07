import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Text } from 'react-native';
import { attachmentIdOf, MarkdownPreview } from '../../../src/features/editor/MarkdownPreview';

// marked resolves to its ES module build, which Jest does not transform; use the UMD build.
jest.mock('marked', () =>
  jest.requireActual('../../../../../node_modules/marked/lib/marked.umd.js'),
);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('../../../src/features/attachments/AttachmentImage', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    AttachmentImage: ({ id, onPress }: { id: string; onPress: () => void }) => (
      <RNText onPress={onPress}>{`image ${id}`}</RNText>
    ),
  };
});

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

const show = (body: string, extra: Partial<Parameters<typeof MarkdownPreview>[0]> = {}) =>
  render(<MarkdownPreview body={body} onWikiLink={jest.fn()} {...extra} />);

beforeEach(() => jest.clearAllMocks());

describe('attachmentIdOf', () => {
  it('extracts the id from a nexus attachment URL only', () => {
    expect(attachmentIdOf(`nexus://attachment/${ID}`)).toBe(ID);
    expect(attachmentIdOf('nexus://attachment/short')).toBeNull();
    expect(attachmentIdOf('https://example.com')).toBeNull();
  });
});

describe('MarkdownPreview', () => {
  it('shows a placeholder for an empty body', async () => {
    await show('   \n');
    expect(screen.getByText('Nothing to preview yet.')).toBeTruthy();
  });

  it('renders headings, emphasis, code, entities and the footer', async () => {
    await show('# Title\n\n**bold** _it_ ~~gone~~ `a<b` &amp; \\*star\\*\nline two', {
      reading: true,
      footer: <Text>Footer</Text>,
    });
    expect(screen.getByRole('header', { name: 'Title' })).toBeTruthy();
    expect(screen.getByText('bold')).toBeTruthy();
    expect(screen.getByText('it')).toBeTruthy();
    expect(screen.getByText('gone')).toBeTruthy();
    expect(screen.getByText('a<b')).toBeTruthy();
    expect(screen.getByText(/& \*star\*/)).toBeTruthy();
    expect(screen.getByText('Footer')).toBeTruthy();
  });

  it('renders lists, tasks, quotes, rules, code blocks, tables and html', async () => {
    await show(
      [
        '3. three',
        '4. four',
        '',
        '- [x] done',
        '- [ ] todo',
        '- plain',
        '',
        '> quoted',
        '',
        '---',
        '',
        '```',
        'const x = 1;',
        '```',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '<div>raw</div>',
        '',
        '#### Small heading',
      ].join('\n'),
    );
    expect(screen.getByText('3.')).toBeTruthy();
    expect(screen.getByText('4.')).toBeTruthy();
    expect(screen.getByLabelText('Done', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText('To do', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('•')).toBeTruthy();
    expect(screen.getByText('quoted')).toBeTruthy();
    expect(screen.getByText('const x = 1;')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText(/<div>raw<\/div>/)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Small heading' })).toBeTruthy();
  });

  // Regression: marked (v18) adds a `checkbox` token to each task item, which
  // used to print as "[x]" next to the Done icon.
  it('does not print the raw task checkbox next to the icon', async () => {
    await show('- [x] done\n- [ ] todo');
    expect(screen.queryByText(/\[x\]/)).toBeNull();
    expect(screen.queryByText(/\[ \]/)).toBeNull();
  });

  it('opens wiki links and marks unresolved ones', async () => {
    const onWikiLink = jest.fn();
    await show('See [[Kalman|the filter]] and [[Missing]].', {
      onWikiLink,
      resolved: new Set(['kalman']),
      normalise: (s) => s.toLowerCase(),
    });
    const known = screen.getByText('the filter');
    expect(known.props.accessibilityHint).toBe('Opens the linked note');
    expect(screen.getByText('Missing').props.accessibilityHint).toBe('No note has this title yet');
    await fireEvent.press(known);
    expect(onWikiLink).toHaveBeenCalledWith('Kalman');
  });

  it('treats wiki links as known without a resolved set', async () => {
    await show('[[Anything]]');
    expect(screen.getByText('Anything').props.accessibilityHint).toBe('Opens the linked note');
  });

  it('opens web links in the browser and attachment links in the app', async () => {
    await show(`[site](https://example.com) and [file](nexus://attachment/${ID})`);
    await fireEvent.press(screen.getByText('site'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://example.com');
    await fireEvent.press(screen.getByText('file'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/attachment/[attachmentId]',
      params: { attachmentId: ID },
    });
  });

  it('renders an attachment image on its own line as a block image', async () => {
    await show(`![photo](nexus://attachment/${ID})`);
    await fireEvent.press(screen.getByText(`image ${ID}`));
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('renders inline images as chips', async () => {
    await show(`Look ![](https://x/y.png) and ![pic](nexus://attachment/${ID}) here`);
    expect(screen.getByText('📎 image')).toBeTruthy();
    await fireEvent.press(screen.getByText('📎 pic'));
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});
