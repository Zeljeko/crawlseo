import { describe, expect, it } from "vitest";
import { countWords, pageText, sanitizeHtml } from "./html";

describe("sanitizeHtml", () => {
  it("keeps allowed tags and drops their attributes", () => {
    expect(sanitizeHtml('<h2 class="x" onclick="evil()">Hi</h2><p style="color:red">Text</p>')).toBe("<h2>Hi</h2><p>Text</p>");
  });

  it("removes scripts, styles and iframes with their content", () => {
    expect(sanitizeHtml('<p>a</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><p>b</p>')).toBe("<p>a</p><p>b</p>");
  });

  it("drops unknown tags but keeps their text", () => {
    expect(sanitizeHtml('<div><img src=x onerror=alert(1)><span>text</span></div>')).toBe("text");
  });

  it("keeps only safe link targets", () => {
    expect(sanitizeHtml('<a href="https://ab-businesssupport.com/contact/" target="_blank">c</a>')).toBe(
      '<a href="https://ab-businesssupport.com/contact/">c</a>'
    );
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="//evil.com">x</a>')).toBe("<a>x</a>");
  });

  it("escapes stray angle brackets in text", () => {
    expect(sanitizeHtml("<p>1 < 2 and <scr<script>ipt>x")).toBe("<p>1 &lt; 2 and x");
  });

  it("drops h1", () => {
    expect(sanitizeHtml("<h1>T</h1><p>x</p>")).toBe("T<p>x</p>");
  });
});

describe("countWords / pageText", () => {
  it("counts visible words", () => {
    expect(countWords("<h2>Two words</h2><p>and three&nbsp;more</p>")).toBe(5);
  });

  it("extracts main text without nav, footer or scripts", () => {
    const html = "<html><body><nav>Menu</nav><main><h1>Title</h1><p>Body &amp; more</p><script>x()</script></main><footer>F</footer></body></html>";
    expect(pageText(html)).toBe("Title Body & more");
  });
});
