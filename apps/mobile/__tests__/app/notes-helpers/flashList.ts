// FlashList ships ES modules Jest does not transform, and measures native
// layout to render; a FlatList renders the same rows in tests.
// Use with: jest.mock('@shopify/flash-list', () => jest.requireActual('../notes-helpers/flashList'));
import { FlatList } from 'react-native';

export const FlashList = FlatList;
