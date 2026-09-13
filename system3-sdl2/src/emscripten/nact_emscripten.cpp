#include <stdio.h>
#include "nact.h"
#include "encoding.h"
#include "msgskip.h"
#include <emscripten.h>

namespace {

enum CustomEventCode {
	SET_MESSAGESKIP_MODE,
	SET_MESSAGESKIP_FLAGS,
	SYNC_MESSAGESKIP_FILE,
};

Uint32 custom_event_type = static_cast<Uint32>(-1);

} // namespace

void NACT::text_dialog()
{
	static char buf[256];
	std::string oldstr = encoding->toUtf8(tvar[tvar_index - 1]);
	int ok = EM_ASM_({
			var r = xsystem35.shell.inputString("文字列を入力してください", UTF8ToString($0), $1);
			if (r) {
				stringToUTF8(r, $2, $3);
				return 1;
			}
			return 0;
		}, oldstr.c_str(), tvar_maxlen, buf, sizeof buf);
	if (ok) {
		tvar[tvar_index - 1] = encoding->fromUtf8(buf);
	}
}

void NACT::platform_initialize()
{
	mouse_move_enabled = false;
	if (custom_event_type == static_cast<Uint32>(-1)) {
		custom_event_type = SDL_RegisterEvents(1);
		EM_ASM({ setInterval(() => _msgskip_syncFile(), 5000); });
	}
}

void NACT::platform_finalize()
{
}

void NACT::trace(const char *format, ...)
{
	va_list ap;
	va_start(ap, format);
	vfprintf(stdout, format, ap);
	va_end(ap);
}

void NACT::set_skip_menu_state(bool enabled, bool checked)
{
	EM_ASM({ xsystem35.shell.setSkipButtonState($0, $1); }, enabled, checked);
}

bool NACT::handle_platform_event(const SDL_Event& e)
{
	if (e.type != custom_event_type)
		return false;
	switch (e.user.code) {
	case SET_MESSAGESKIP_MODE:
		msgskip->activate(static_cast<bool>(e.user.data1));
		break;
	case SET_MESSAGESKIP_FLAGS:
		msgskip->set_flags(reinterpret_cast<unsigned>(e.user.data1),
						   reinterpret_cast<unsigned>(e.user.data2));
		break;
	case SYNC_MESSAGESKIP_FILE:
		if (msgskip->write_to_file())
			EM_ASM( xsystem35.shell.syncfs(); );
		break;
	}
	return true;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
void msgskip_activate(int enable) {
	SDL_Event event;
	memset(&event, 0, sizeof(event));
	event.type = custom_event_type;
	event.user.code = SET_MESSAGESKIP_MODE;
	event.user.data1 = (void*)enable;
	SDL_PushEvent(&event);
}

EMSCRIPTEN_KEEPALIVE
void msgskip_setFlags(unsigned flags, unsigned mask) {
	if (!SDL_WasInit(SDL_INIT_EVENTS)) {
		// Retry.
		EM_ASM({ setTimeout(() => _msgskip_setFlags($0, $1), 50); }, flags, mask);
		return;
	}
	SDL_Event event;
	memset(&event, 0, sizeof(event));
	event.type = custom_event_type;
	event.user.code = SET_MESSAGESKIP_FLAGS;
	event.user.data1 = (void*)flags;
	event.user.data2 = (void*)mask;
	SDL_PushEvent(&event);
}

EMSCRIPTEN_KEEPALIVE
void msgskip_syncFile() {
	SDL_Event event;
	memset(&event, 0, sizeof(event));
	event.type = custom_event_type;
	event.user.code = SYNC_MESSAGESKIP_FILE;
	SDL_PushEvent(&event);
}

// ---------------------------------------------------------------------------
// Trainer / walkthrough bridge for the web shell.
//
// Read and write access to the interpreter's script variables.  These are thin
// accessors over state the VM already owns; nothing runs unless the shell asks
// for it.  All of them are safe to call while the game is running, because
// Asyncify only hands control back to JavaScript between frames, never in the
// middle of an instruction.
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int cheat_engine_id() {
	return 2; // 2 = system3 (Alice Soft System 3, which Rance 4.1/4.2 use)
}

EMSCRIPTEN_KEEPALIVE
int cheat_page() {
	return g_nact ? g_nact->sco.page() : -1;
}

EMSCRIPTEN_KEEPALIVE
int cheat_addr() {
	return g_nact ? g_nact->sco.cmd_addr() : -1;
}

EMSCRIPTEN_KEEPALIVE
int cheat_var_count() {
	return MAX_VAR;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t cheat_var_ptr() {
	return g_nact ? reinterpret_cast<uintptr_t>(g_nact->var_data()) : 0;
}

EMSCRIPTEN_KEEPALIVE
int cheat_get_var(int index) {
	if (!g_nact || index < 0 || index >= MAX_VAR)
		return -1;
	return g_nact->get_var(index);
}

EMSCRIPTEN_KEEPALIVE
int cheat_set_var(int index, int value) {
	if (!g_nact || index < 0 || index >= MAX_VAR)
		return -1;
	g_nact->set_var(index, static_cast<uint16>(value & 0xffff));
	return g_nact->get_var(index);
}

EMSCRIPTEN_KEEPALIVE
const char* cheat_var_name(int index) {
	static char buf[16];
	if (index < 0 || index >= MAX_VAR)
		return "";
	snprintf(buf, sizeof(buf), "VAR%d", index);
	return buf;
}

EMSCRIPTEN_KEEPALIVE
int cheat_strvar_count() {
	return MAX_STRVAR;
}

EMSCRIPTEN_KEEPALIVE
const char* cheat_get_strvar(int index) {
	static std::string buf;
	if (!g_nact || index < 0 || index >= MAX_STRVAR)
		return "";
	buf = g_nact->encoding->toUtf8(g_nact->get_string(index));
	return buf.c_str();
}

EMSCRIPTEN_KEEPALIVE
int cheat_set_strvar(int index, const char* utf8) {
	if (!g_nact || index < 0 || index >= MAX_STRVAR)
		return 0;
	g_nact->set_string(index, g_nact->encoding->fromUtf8(utf8 ? utf8 : ""));
	return 1;
}

// The System 3 engine has no array pages or 64-bit variables; the shell hides
// those panels when these report zero.
EMSCRIPTEN_KEEPALIVE
int cheat_page_count() {
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int cheat_page_size(int page) {
	(void)page;
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int cheat_page_saveflag(int page) {
	(void)page;
	return 0;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t cheat_page_ptr(int page) {
	(void)page;
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int cheat_get_page_var(int page, int index) {
	(void)page;
	(void)index;
	return -1;
}

EMSCRIPTEN_KEEPALIVE
int cheat_set_page_var(int page, int index, int value) {
	(void)page;
	(void)index;
	(void)value;
	return -1;
}

EMSCRIPTEN_KEEPALIVE
int cheat_longvar_count() {
	return 0;
}

EMSCRIPTEN_KEEPALIVE
double cheat_get_longvar(int index) {
	(void)index;
	return 0.0;
}

EMSCRIPTEN_KEEPALIVE
int cheat_set_longvar(int index, double value) {
	(void)index;
	(void)value;
	return 0;
}

} // extern "C"
