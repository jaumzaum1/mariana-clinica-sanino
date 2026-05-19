export function onlyDigits(input: string): string {
  return input.replace(/\D/g, "");
}

export function normalizeBrazilPhone(input: string): string {
  const digits = onlyDigits(input);

  if (digits.startsWith("55")) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

export function generateBrazilWhatsappVariants(input: string): string[] {
  const normalized = normalizeBrazilPhone(input);
  const variants = [normalized];

  if (normalized.startsWith("55")) {
    const countryCode = normalized.slice(0, 2);
    const areaCode = normalized.slice(2, 4);
    const localNumber = normalized.slice(4);

    if (localNumber.length === 9 && localNumber.startsWith("9")) {
      variants.push(`${countryCode}${areaCode}${localNumber.slice(1)}`);
    }

    if (localNumber.length === 8) {
      variants.push(`${countryCode}${areaCode}9${localNumber}`);
    }
  }

  return [...new Set(variants)];
}
