// Copyright (c) 2019 Kichikuou <KichikuouChrome@gmail.com>
// This source code is governed by the MIT License, see the LICENSE file.

const dictionary_en = {
    cannot_install: 'Cannot install',
    error_occurred: 'An error occurred.',
    input_char_limit: (maxLength: number) => `Up to ${maxLength} characters`,
    midi_init_error: 'Failed to initialize MIDI synthesizer.',
    module_load_failed: (src: string) => `Failed to load ${src}. Please reload the page.`,
    no_gamedata: 'No game data (*SA.ALD or ADISK.DAT) found.',
    no_gamedata_dir: 'No GAMEDATA folder in the image.',
    floppy_images_cant_be_used: 'Floppy disk images cannot be loaded.',
    pc98_images_cant_be_used: 'PC-98 version of this game is not supported. Please use the Windows version.',
    restart_confirmation: 'Restart the game?',
    restore_success: 'Save files has been restored successfully.',
    restore_failure: 'Save files could not be restored.',
    streamer_mode_not_available: 'Streamer mode is not available for this game.',
    unload_confirmation: 'Unsaved data will be lost.',
    unrecognized_format: 'Unrecognized format.',
};
type Dictionary = typeof dictionary_en;

const dictionary_ja: Dictionary = {
    cannot_install: 'インストールできません',
    error_occurred: 'エラーが発生しました。',
    input_char_limit: (maxLength: number) => `全角${maxLength}文字まで`,
    midi_init_error: 'MIDIシンセサイザの初期化に失敗しました。',
    module_load_failed: (src: string) => src + 'の読み込みに失敗しました。リロードしてください。',
    no_gamedata: 'ゲームデータ (*SA.ALD または ADISK.DAT) が見つかりません。',
    no_gamedata_dir: 'イメージ内にGAMEDATAフォルダが見つかりません。',
    floppy_images_cant_be_used: 'フロッピーディスクイメージは読み込めません。Windows版のデータを使用してください。',
    pc98_images_cant_be_used: 'このゲームのPC-98版はサポート対象外です。Windows版のデータを使用してください。',
    restart_confirmation: 'ゲームを再起動しますか？',
    restore_success: 'セーブデータの復元に成功しました。',
    restore_failure: 'セーブデータを復元できませんでした。',
    streamer_mode_not_available: 'このゲームでは配信者モードは利用できません。',
    unload_confirmation: 'セーブしていないデータは失われます。',
    unrecognized_format: '認識できない形式です。',
};

const dictionary_zh: Dictionary = {
    cannot_install: '无法安装',
    error_occurred: '发生错误。',
    input_char_limit: (maxLength: number) => `最多输入 ${maxLength} 个字符`,
    midi_init_error: 'MIDI 合成器初始化失败。',
    module_load_failed: (src: string) => `加载 ${src} 失败，请刷新页面。`,
    no_gamedata: '找不到游戏数据（*SA.ALD 或 ADISK.DAT）。',
    no_gamedata_dir: '镜像中找不到 GAMEDATA 文件夹。',
    floppy_images_cant_be_used: '无法加载软盘镜像，请使用 Windows 版游戏数据。',
    pc98_images_cant_be_used: '不支持 PC-98 版游戏，请使用 Windows 版游戏数据。',
    restart_confirmation: '要重启游戏吗？',
    restore_success: '存档恢复成功。',
    restore_failure: '无法恢复存档。',
    streamer_mode_not_available: '此游戏不支持主播模式。',
    unload_confirmation: '未保存的数据将会丢失。',
    unrecognized_format: '无法识别的格式。',
};

const dicts:{[language: string]: Dictionary} = {
    en: dictionary_en,
    ja: dictionary_ja,
    'zh-CN': dictionary_zh,
    zh: dictionary_zh,
};

function selectDictionary(): Dictionary {
    let lang = document.documentElement.getAttribute('lang');
    if (lang && dicts[lang])
        return dicts[lang];
    return dictionary_en;
}
export const message = selectDictionary();
