/*
 * cheat.c  Trainer / walkthrough bridge for the web shell.
 *
 * The web UI needs to read and write the interpreter's script variables while
 * a game is running.  Nothing here changes engine behaviour: every function is
 * a thin accessor over state the VM already owns, and is only reachable when
 * the TypeScript shell explicitly calls it.
 *
 * This file is compiled into the xsystem35 executable (not src_lib) so it can
 * use both the variable store and the NACT page counters.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "portab.h"
#include "variable.h"
#include "utfsjis.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define CHEAT_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define CHEAT_EXPORT
#endif

/* Defined in nact.c.  Declared here instead of including nact.h so that this
 * accessor layer does not depend on the NACT struct layout. */
extern int nact_current_page(void);
extern int nact_current_addr(void);

/* Last UTF-8 conversion handed to the shell.
 *
 * The shell reads the returned pointer with UTF8ToString() before calling any
 * other cheat_* function, so a single reused buffer is enough and keeps the
 * bridge free of leaks. */
static char *utf8_scratch;

static const char *to_utf8(const char *src) {
	char *converted;

	free(utf8_scratch);
	utf8_scratch = NULL;
	if (src == NULL)
		src = "";
	converted = codeconv(UTF8, v_get_encoding(), src);
	if (converted == NULL)
		converted = strdup(src);
	utf8_scratch = converted;
	return utf8_scratch != NULL ? utf8_scratch : "";
}

CHEAT_EXPORT int cheat_engine_id(void) {
	return 1; /* 1 = xsystem35 (System 3.5 and earlier) */
}

CHEAT_EXPORT int cheat_page(void) {
	return nact_current_page();
}

CHEAT_EXPORT int cheat_addr(void) {
	return nact_current_addr();
}

CHEAT_EXPORT int cheat_var_count(void) {
	return v_sysvar_max();
}

/* Base address of the system variable array, so the shell can copy the whole
 * table in one shot instead of one call per variable. */
CHEAT_EXPORT uintptr_t cheat_var_ptr(void) {
	return (uintptr_t)sysVar;
}

CHEAT_EXPORT int cheat_get_var(int index) {
	if (index < 0 || index >= v_sysvar_max())
		return -1;
	return sysVar[index];
}

CHEAT_EXPORT int cheat_set_var(int index, int value) {
	if (index < 0 || index >= v_sysvar_max())
		return -1;
	sysVar[index] = (vmvar_t)(value & 0xffff);
	return sysVar[index];
}

CHEAT_EXPORT const char *cheat_var_name(int index) {
	if (index < 0 || index >= v_sysvar_max())
		return "";
	return to_utf8(v_name(index));
}

CHEAT_EXPORT int cheat_strvar_count(void) {
	return svar_maxindex() + 1;
}

CHEAT_EXPORT const char *cheat_get_strvar(int index) {
	if (index < 0 || index >= svar_maxindex() + 1)
		return "";
	return to_utf8(svar_get(index));
}

CHEAT_EXPORT int cheat_set_strvar(int index, const char *utf8) {
	char *encoded;

	if (index < 0 || index >= svar_maxindex() + 1)
		return 0;
	if (utf8 == NULL)
		utf8 = "";
	encoded = codeconv(v_get_encoding(), UTF8, utf8);
	if (encoded == NULL)
		return 0;
	svar_set(index, encoded);
	free(encoded);
	return 1;
}

CHEAT_EXPORT int cheat_page_count(void) {
	return v_page_max();
}

CHEAT_EXPORT int cheat_page_size(int page) {
	if (page <= 0 || page >= v_page_max())
		return 0;
	return varPage[page].size;
}

CHEAT_EXPORT int cheat_page_saveflag(int page) {
	if (page <= 0 || page >= v_page_max())
		return 0;
	return varPage[page].saveflag ? 1 : 0;
}

CHEAT_EXPORT uintptr_t cheat_page_ptr(int page) {
	if (page <= 0 || page >= v_page_max() || varPage[page].value == NULL)
		return 0;
	return (uintptr_t)varPage[page].value;
}

CHEAT_EXPORT int cheat_get_page_var(int page, int index) {
	if (page <= 0 || page >= v_page_max() || varPage[page].value == NULL)
		return -1;
	if (index < 0 || index >= varPage[page].size)
		return -1;
	return varPage[page].value[index];
}

CHEAT_EXPORT int cheat_set_page_var(int page, int index, int value) {
	if (page <= 0 || page >= v_page_max() || varPage[page].value == NULL)
		return -1;
	if (index < 0 || index >= varPage[page].size)
		return -1;
	varPage[page].value[index] = (vmvar_t)(value & 0xffff);
	return varPage[page].value[index];
}

CHEAT_EXPORT int cheat_longvar_count(void) {
	return v_longvar_max();
}

CHEAT_EXPORT double cheat_get_longvar(int index) {
	if (index < 0 || index >= v_longvar_max())
		return 0.0;
	return longVar[index];
}

CHEAT_EXPORT int cheat_set_longvar(int index, double value) {
	if (index < 0 || index >= v_longvar_max())
		return 0;
	longVar[index] = value;
	return 1;
}
