import { test, expect } from "@playwright/test";

/**
 * Golden-path smoke test.
 *
 * Scope note: a true end-to-end "send a WhatsApp message" flow needs a
 * real Meta WhatsApp Business API connection, which a local dev
 * environment doesn't have (see .env.local's META_APP_SECRET
 * placeholder and WHATSAPP_TEMPLATES_DRY_RUN). This test instead covers
 * the golden path that IS exercisable without external credentials:
 * sign up -> land authenticated on the dashboard -> create a contact
 * through the real UI against the real (local) Supabase -> see it
 * persisted. That's still a genuine boot-to-database round trip through
 * a real browser, not a mock — it catches "the app doesn't build/boot",
 * "auth is broken", and "the most-used CRUD form is broken" regressions,
 * which is what a smoke test is for.
 *
 * Submission note: the contact form's "Criar" button is a plain
 * `<Button type="submit">` (src/components/ui/button.tsx, wrapping
 * @base-ui/react's Button) with no explicit onClick — it's supposed to
 * submit natively via being a submit button inside a <form>. Clicking it
 * with Playwright does NOT trigger form submission (verified: no
 * network request, no toast, no "saving" state — nothing happens),
 * while `form.requestSubmit()` and pressing Enter in a field both work
 * correctly and reach the real handleSubmit. The dialog's OTHER button
 * ("Adicionar contato", which has an explicit onClick) clicks fine. This
 * looks like a real interaction bug in how @base-ui/react's Button
 * handles native submit-on-click without an onClick prop attached — see
 * the flag in docs/engineering-standards-progress.md for the follow-up
 * this deserves (it's a separate, bigger investigation than one E2E
 * test — worth a human confirming whether it reproduces with a real
 * mouse in a real browser before treating it as confirmed-affects-users).
 * Submitting via Enter here is a legitimate real-user interaction
 * (pressing Enter after filling a form's last required field), not a
 * workaround that defeats the test's purpose.
 */
test("sign up, land on dashboard, create a contact", async ({ page }) => {
  const uniqueEmail = `e2e-${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.locator("#fullName").fill("E2E Test User");
  await page.locator("#email").fill(uniqueEmail);
  await page.locator("#password").fill("correct horse battery staple");
  await page.locator("#confirmPassword").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();

  // Email confirmation is disabled locally (see supabase/config.toml),
  // so signUp() returns an active session and the app does a full-page
  // navigation straight to /dashboard (src/app/(auth)/signup/page.tsx) -
  // no "check your email" screen to get past here.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByText("Dashboard", { exact: true }).first()).toBeVisible();

  await page.goto("/contacts");
  await expect(page.getByText("Contatos", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Adicionar contato" }).click();
  await page.locator("#cf-name").fill("Cliente Teste E2E");
  await page.locator("#cf-phone").fill("+15551234567");
  await page.locator("#cf-phone").press("Enter");

  await expect(page.getByText("Contato criado com sucesso")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("Cliente Teste E2E")).toBeVisible();
});
