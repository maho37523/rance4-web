// Curated trainer presets.
//
// A preset is only added here after its variable index has been checked
// against a running game — see tools/diag/NOTES-cheats.md for how each entry
// was confirmed and what evidence backs it.  An empty list is the honest
// state: the 数值搜索 tab still lets the player find any value by hand.
//
// `index` is a system variable number for the game's own engine:
//   rance4        -> xsystem35  sysVar[index]
//   rance41/42    -> system3    var[index]

export type Preset = {
    index: number;
    label: string;
    varLabel?: string;
    note?: string;
    step?: number;
    suggested?: number;
};

export type EngineKind = 'xsystem35' | 'system3';

const presets: Record<string, Preset[]> = {};

export function getPresets(game: string, engine: EngineKind): Preset[] {
    return presets[`${game}:${engine}`] ?? presets[game] ?? [];
}

// Exported for the diagnostics page: it lists what is currently wired up.
export function allPresets(): Record<string, Preset[]> {
    return presets;
}
