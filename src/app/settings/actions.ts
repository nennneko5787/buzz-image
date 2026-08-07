"use server";

import { revalidatePath } from "next/cache";

import { login, logout, requirePanelSession } from "@/lib/panel-auth";
import {
  getSettings,
  resetSettings,
  saveSettings,
  setPanelPassword,
  verifyPanelPassword,
} from "@/lib/settings";
import {
  type PanelActionState,
  type SettingsFormValues,
  parseFormValues,
} from "@/lib/settings-schema";

/**
 * 設定パネルの Server Action。
 *
 * Server Action は UI を経由しない POST でも呼べるので、
 * 認証は必ずこのファイルの中で確かめる（画面を出さないことは防御にならない）。
 */

const PASSWORD_MIN_LENGTH = 8;

export async function loginAction(
  _prev: PanelActionState,
  formData: FormData,
): Promise<PanelActionState> {
  const password = String(formData.get("password") ?? "");
  const result = await login(password);

  if (!result.ok) return { status: "error", message: result.message };
  return { status: "ok", message: "ログインしました。" };
}

export async function logoutAction(): Promise<void> {
  await logout();
  revalidatePath("/settings");
}

export async function saveSettingsAction(
  values: Partial<SettingsFormValues>,
): Promise<PanelActionState> {
  await requirePanelSession();

  const current = await getSettings();
  const { settings, errors } = parseFormValues(values, current);

  if (errors.length > 0) {
    return { status: "error", message: errors.join(" / ") };
  }

  await saveSettings(settings);
  revalidatePath("/settings");
  revalidatePath("/");

  return { status: "ok", message: "保存しました。" };
}

export async function resetSettingsAction(): Promise<PanelActionState> {
  await requirePanelSession();

  await resetSettings();
  revalidatePath("/settings");
  revalidatePath("/");

  return { status: "ok", message: ".env の内容に戻しました。" };
}

export async function changePasswordAction(
  _prev: PanelActionState,
  formData: FormData,
): Promise<PanelActionState> {
  await requirePanelSession();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (!(await verifyPanelPassword(currentPassword))) {
    return { status: "error", message: "現在のパスワードが違います。" };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      status: "error",
      message: `新しいパスワードは ${PASSWORD_MIN_LENGTH} 文字以上にしてください。`,
    };
  }
  if (password !== confirmation) {
    return { status: "error", message: "確認用のパスワードが一致しません。" };
  }

  await setPanelPassword(password);
  // パスワードを変えると発行済みのセッションは無効になるので、その場で入り直す
  await login(password);
  revalidatePath("/settings");

  return { status: "ok", message: "パスワードを変更しました。" };
}
