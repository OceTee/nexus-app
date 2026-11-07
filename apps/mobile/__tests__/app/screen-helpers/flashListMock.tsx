// @shopify/flash-list ships ES modules that Jest does not transform; a
// FlatList renders the same rows for screen tests.
import { FlatList } from 'react-native';

export const FlashList = FlatList;
