#include <string.h>
#include "unittest.h"
#include "utfsjis.h"

void utfsjis_test(void) {
	const char gbk[] = "\xc0\xbc\xcb\xb9";
	ASSERT_TRUE(advance_char(gbk, GBK) == gbk + 2);
	ASSERT_TRUE(advance_char(gbk + 1, GBK) == gbk + 2);
	char ascii_input[] = "A";
	ASSERT_TRUE(advance_char(ascii_input, GBK) == ascii_input + 1);
	char *ascii = (char *)gbk2utf((const uint8_t *)"abc");
	ASSERT_STRCMP(ascii, "abc");
	free(ascii);
}
