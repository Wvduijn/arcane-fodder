import Phaser from 'phaser';
import { LocalStorageSaveRepository } from '@platform/storage/LocalStorageSaveRepository';
import { createGameConfig } from './app/config';

// The one save repository of the session (M6 T9): created at boot, handed to the scenes.
new Phaser.Game(createGameConfig({ saves: new LocalStorageSaveRepository() }));
