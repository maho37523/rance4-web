// Walkthrough registry.
//
// Each entry is written from published sources; every guide carries its own
// source list, which the viewer renders at the bottom of every section.
import type {Guide} from './types.js';
import {rance4} from './rance4.js';
import {rance41} from './rance41.js';
import {rance42} from './rance42.js';
import {ranceking} from './ranceking.js';

export type {Guide, GuideSection, GuideBlock, GuideSource} from './types.js';

export const guides: Record<string, Guide> = {
    rance4,
    rance41,
    rance42,
    ranceking,
};
