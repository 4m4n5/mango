import type { CatalogTab } from './rails.js';
import {
  listSavedLibraryItems,
  saveLibraryItem,
  unsaveLibraryItem,
  type SavedLibraryItem,
} from './library/db.js';

export type UserPin = {
  tab: CatalogTab;
  type: string;
  id: string;
  title: string;
  poster: string;
  pinned_at: number;
};

function savedToPin(item: SavedLibraryItem): UserPin {
  return {
    tab: item.tab,
    type: item.type,
    id: item.id,
    title: item.title,
    poster: item.poster || '',
    pinned_at: item.saved_at,
  };
}

export async function listUserPins(tab?: CatalogTab): Promise<UserPin[]> {
  return listSavedLibraryItems(tab).map(savedToPin);
}

export async function addUserPin(input: {
  tab: CatalogTab;
  type: string;
  id: string;
  title?: string;
  poster?: string;
}): Promise<UserPin> {
  return savedToPin(saveLibraryItem({
    tab: input.tab,
    type: input.type,
    id: input.id,
    title: input.title,
    poster: input.poster,
    saved_by: 'user',
  }));
}

export async function removeUserPin(input: {
  tab: CatalogTab;
  type: string;
  id: string;
}): Promise<boolean> {
  return unsaveLibraryItem({
    type: input.type,
    id: input.id,
  });
}
