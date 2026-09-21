import { describe, expect, it } from "vitest";
import {
  countryLabel,
  extractTikTokProfile,
  formatCount,
  mergeAccounts,
  parseSigiState,
  parseTikTokUniversal,
  tiktokUsernameFromUrl,
} from "./tiktokProfile";
import { detectStoryLink } from "./validation";

const universalFixture = {
  __DEFAULT_SCOPE__: {
    "webapp.user-detail": {
      statusCode: 0,
      userInfo: {
        user: {
          id: "86328792343818240",
          uniqueId: "khaby.lame",
          nickname: "Khaby Lame",
          avatarLarger: "https://p16-sign-va.tiktokcdn.com/avatar-300x300.jpeg",
          signature: "Things you can relate to.",
          verified: true,
          privateAccount: false,
          secUid: "MS4wLjABA",
          region: "IT",
          following: 5,
          heart: 257300000,
          videoCount: 1270,
        },
        stats: {
          followerCount: 82400000,
          followingCount: 5,
          heartCount: 257300000,
          videoCount: 1270,
        },
      },
    },
  },
};

describe("تحليل بيانات حساب TikTok", () => {
  it("يستخرج الاسم ويوزر والمتابعين والمنشورات والدولة من بيانات Universal Data", () => {
    const account = parseTikTokUniversal(universalFixture);
    expect(account).toBeDefined();
    expect(account!.nickname).toBe("Khaby Lame");
    expect(account!.username).toBe("khaby.lame");
    expect(account!.followers).toBe(82400000);
    expect(account!.posts).toBe(1270);
    expect(account!.region).toBe("IT");
    expect(account!.verified).toBe(true);
    expect(account!.profileUrl).toBe("https://www.tiktok.com/@khaby.lame");
  });

  it("يستخرج بطاقة الحساب من نص صفحة HTML كامل", () => {
    const html = `<html><body>
      <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(universalFixture)}</script>
    </body></html>`;
    const account = extractTikTokProfile(html);
    expect(account?.nickname).toBe("Khaby Lame");
    expect(account?.followers).toBe(82400000);
    expect(account?.posts).toBe(1270);
    expect(countryLabel(account?.region)).toBe("إيطاليا");
  });

  it("يترجم رموز الدول العربية والأجنبية إلى أسماء", () => {
    expect(countryLabel("IQ")).toBe("العراق");
    expect(countryLabel("US")).toBe("الولايات المتحدة");
    expect(countryLabel("SA")).toBe("السعودية");
    expect(countryLabel("XX")).toBe("XX");
    expect(countryLabel(undefined)).toBeUndefined();
  });

  it("يصيغ أعداد المتابعين بصيغة عربية مختصرة", () => {
    expect(formatCount(82400000)).toBe("82.4 مليون");
    expect(formatCount(1270)).toBe("1.3 ألف");
    expect(formatCount(345)).toBe("345");
    expect(formatCount(undefined)).toBeUndefined();
    expect(formatCount(0)).toBe("0");
  });

  it("يستخرج حساباً من SIGI_STATE عند غياب Universal Data", () => {
    const sigi = {
      UserModule: {
        users: {
          "MS4wLjAB": {
            nickname: "khaby",
            uniqueId: "khaby.lame",
            verified: true,
            signature: "hi",
            avatarLarger: "https://x/avatar.jpeg",
            fanCount: 82400000,
            videoCount: 1270,
            heart: 257300000,
            region: "IT",
          },
        },
        stats: {
          "khaby.lame": { followingCount: 5 },
        },
      },
    };
    const account = parseSigiState(sigi);
    expect(account?.nickname).toBe("khaby");
    expect(account?.username).toBe("khaby.lame");
    expect(account?.followers).toBe(82400000);
    expect(account?.posts).toBe(1270);
  });

  it("يستخرج اسم المستخدم من رابط فيديو TikTok", () => {
    expect(tiktokUsernameFromUrl("https://www.tiktok.com/@khaby.lame/video/7107337212743830830")).toBe("khaby.lame");
    expect(tiktokUsernameFromUrl("https://vt.tiktok.com/ZSVXE4oUt/")).toBeUndefined();
  });

  it("يدمج مصادر متعددة مع أولوية القيم المتوفرة", () => {
    const merged = mergeAccounts(
      { nickname: "اختبار", followers: 10 },
      { username: "test.user", region: "IQ" },
      { nickname: "مختلف", followers: 99 },
    );
    expect(merged).toEqual({ nickname: "اختبار", followers: 10, username: "test.user", region: "IQ" });
    expect(mergeAccounts(undefined, undefined)).toBeUndefined();
  });

  it("لا يستخرج حساباً من صفحة وهمية صغيرة", () => {
    expect(extractTikTokProfile("<html><body>challenge</body></html>")).toBeUndefined();
  });
});

describe("كشف روابط القصص", () => {
  it("يميز قصص Instagram عن المنشورات", () => {
    expect(detectStoryLink("https://www.instagram.com/stories/khaby.lame/1234567890123456/")).toBe(true);
    expect(detectStoryLink("https://www.instagram.com/reel/Cxyz/")).toBe(false);
  });

  it("يميز قصص Facebook وSnapchat", () => {
    expect(detectStoryLink("https://www.facebook.com/stories/1234567890123456/")).toBe(true);
    expect(detectStoryLink("https://www.snapchat.com/highlight/seen/123/")).toBe(true);
    expect(detectStoryLink("https://snapchat.com/t/AbCdEfGh/")).toBe(true);
    expect(detectStoryLink("https://www.snapchat.com/spotlight/123/")).toBe(true);
  });

  it("لا يعتبر روابط TikTok وX وPinterest روابط قصص", () => {
    expect(detectStoryLink("https://www.tiktok.com/@u/video/123")).toBe(false);
    expect(detectStoryLink("https://x.com/u/status/123")).toBe(false);
    expect(detectStoryLink("https://pin.it/abc")).toBe(false);
  });
});