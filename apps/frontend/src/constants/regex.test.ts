import { describe, expect, it } from 'vitest';

import { urlRegex } from "./regex";

const globalUrlRegex = new RegExp(urlRegex.source, 'gi');


describe("urlRegex", () => {
  it("should match URLs that start with http or www", () => {
    const text = "Check out https://www.example.com and www.test.com for more info.";
    const matches = text.match(globalUrlRegex);
    expect(matches).toEqual(["https://www.example.com", "www.test.com"]);
  });

  it("should match partial URLs (domain names) with different TLDs", () => {
    const text = "Visit meedan.com, meedan.org.br, meedan.info.in and app.suwali.io for details.";
    const matches = text.match(globalUrlRegex);
    expect(matches).toEqual(["meedan.com", "meedan.org.br", "meedan.info.in", "app.suwali.io"]);
  });

  it("should not match invalid URLs", () => {
    const text = "This is not a URL: example, nor is this: www.";
    const matches = text.match(globalUrlRegex);
    expect(matches).toBeNull();
  });

  it("should match valid URLs with different TLDs", () => {
    const text = "Check out these websites: https://first-site.com/, https://second.com/, https://thirdsitenews.net/, https://fourthsite.com/, https://fifthsite.org/, and https://sixthsite.com/";
    const matches = text.match(globalUrlRegex);
    expect(matches).toEqual([
      "https://first-site.com",
      "https://second.com",
      "https://thirdsitenews.net",
      "https://fourthsite.com",
      "https://fifthsite.org",
      "https://sixthsite.com"
    ]);
  });
});
