import { describe, expect, it } from "vitest";
import { isAdmin, pseudonym, type Membership } from "@/lib/services/community";

describe("pseudonym (anonymous attribution)", () => {
  it("is deterministic per community+user", () => {
    expect(pseudonym("c1", "u1")).toBe(pseudonym("c1", "u1"));
  });

  it("differs across communities and users", () => {
    expect(pseudonym("c1", "u1")).not.toBe(pseudonym("c2", "u1"));
    expect(pseudonym("c1", "u1")).not.toBe(pseudonym("c1", "u2"));
  });

  it("leaks no identity material", () => {
    const label = pseudonym("community-abc", "user-secret-email@example.com");
    expect(label).toMatch(/^Student #[0-9A-F]{3}$/);
    expect(label).not.toContain("secret");
    expect(label).not.toContain("community-abc");
    expect(label).not.toContain("@");
  });
});

describe("isAdmin (permission gate)", () => {
  it("admits only admin memberships", () => {
    expect(isAdmin({ communityId: "c", userId: "u", role: "admin" })).toBe(true);
    expect(isAdmin({ communityId: "c", userId: "u", role: "member" })).toBe(false);
    expect(isAdmin(null as unknown as Membership)).toBe(false);
  });
});
