import { describe, expect, it } from "vitest";
import {
  generateBrazilWhatsappVariants,
  normalizeBrazilPhone,
  onlyDigits
} from "../utils/phone.js";

describe("phone utils", () => {
  it("keeps only digits", () => {
    expect(onlyDigits("+55 (61) 99653-1507")).toBe("5561996531507");
  });

  it("normalizes local Brazilian numbers with country code", () => {
    expect(normalizeBrazilPhone("(61) 99653-1507")).toBe("5561996531507");
  });

  it("generates WhatsApp variants from 9-digit local number", () => {
    expect(generateBrazilWhatsappVariants("5561996531507")).toEqual([
      "5561996531507",
      "556196531507"
    ]);
  });

  it("generates WhatsApp variants from 8-digit local number", () => {
    expect(generateBrazilWhatsappVariants("+55 (61) 9653-1507")).toEqual([
      "556196531507",
      "5561996531507"
    ]);
  });
});
