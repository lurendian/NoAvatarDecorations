// NoAvatarDecorations
// Revenge / Vendetta-compatible plugin that hides avatar decorations
// (the cosmetic frames Discord draws around avatars) across the whole app.
//
// Why an earlier version only removed *some*: Discord's bundle frequently
// contains MORE THAN ONE module exporting the same decoration helper
// (e.g. several copies of `getAvatarDecorationURL`). Patching only the first
// match leaves every component that imported a different copy untouched, so
// roughly "half" of decorations survive on every surface. This version patches
// EVERY matching module, and strips the underlying `avatarDecorationData` from
// every user/member/profile record source, so there's no path left that can
// rebuild the decoration.
//
// Chokepoints covered (each guarded; unknown modules are skipped, not fatal):
//   A) ALL decoration URL resolver modules -> return null.
//   B) `avatarDecorationData` stripped from UserStore / GuildMemberStore /
//      UserProfileStore / DisplayProfileStore records (incl. nested user).
//   C) Decoration prop stripped from avatar render components.
//   D) Dedicated decoration component blanked (final fallback).

import * as metro from "@vendetta/metro";
import { before, after, instead } from "@vendetta/patcher";

const { findByProps, findByStoreName } = metro as any;

const patches: Array<() => void> = [];
const track = (unpatch?: (() => void) | null) => {
	if (unpatch) patches.push(unpatch);
};

function safe(label: string, fn: () => void) {
	try {
		fn();
	} catch (err) {
		console.log(`[NoAvatarDecorations] patch "${label}" failed:`, err);
	}
}

// Return EVERY module exposing the given props. Uses findByPropsAll when the
// runtime provides it, otherwise falls back to the single-match findByProps.
function allByProps(...props: string[]): any[] {
	const findAll = (metro as any).findByPropsAll;
	if (typeof findAll === "function") {
		try {
			const res = findAll(...props);
			if (Array.isArray(res)) return res.filter(Boolean);
		} catch {}
	}
	const one = findByProps(...props);
	return one ? [one] : [];
}

// Remove every decoration-ish field we know about from an object, in place.
function stripDecoration(obj: any) {
	if (!obj || typeof obj !== "object") return obj;
	try {
		if ("avatarDecoration" in obj) obj.avatarDecoration = null;
		if ("avatarDecorationData" in obj) obj.avatarDecorationData = null;
		if ("decoration" in obj) obj.decoration = null;
	} catch {}
	return obj;
}

export default {
	onLoad() {
		// (A) Neutralize ALL decoration URL resolver modules --------------
		for (const name of ["getAvatarDecorationURL", "getUserAvatarDecorationURL"]) {
			safe(`url:${name}`, () => {
				let count = 0;
				for (const mod of allByProps(name)) {
					if (typeof mod?.[name] === "function") {
						track(instead(name, mod, () => null));
						count++;
					}
				}
				console.log(`[NoAvatarDecorations] patched ${count} module(s) for ${name}`);
			});
		}

		// (B) Strip decoration data from every user/profile record source -
		const storeFns: Record<string, string[]> = {
			UserStore: ["getUser", "getCurrentUser"],
			GuildMemberStore: ["getMember"],
			UserProfileStore: ["getUserProfile", "getGuildMemberProfile"],
			DisplayProfileStore: ["getUserProfile", "getGuildMemberProfile"],
		};
		for (const [storeName, fns] of Object.entries(storeFns)) {
			safe(`store:${storeName}`, () => {
				const store = findByStoreName?.(storeName);
				if (!store) return;
				for (const fn of fns) {
					if (typeof store[fn] !== "function") continue;
					track(
						after(fn, store, (_a: any, r: any) => {
							stripDecoration(r);
							if (r && typeof r === "object") {
								stripDecoration(r.user);
								stripDecoration(r.userProfile);
							}
							return r;
						}),
					);
				}
				if (typeof store.getUsers === "function")
					track(
						after("getUsers", store, (_a: any, users: any) => {
							if (users && typeof users === "object")
								for (const k in users) stripDecoration(users[k]);
							return users;
						}),
					);
			});
		}

		// (C) Strip the decoration prop fed into avatar render components --
		for (const compName of ["Avatar", "AnimatedAvatar", "DecoratedAvatar"]) {
			safe(`render:${compName}`, () => {
				for (const mod of allByProps(compName)) {
					if (typeof mod?.[compName] === "function")
						track(
							before(compName, mod, (args: any[]) => {
								if (args && args[0]) stripDecoration(args[0]);
							}),
						);
				}
			});
		}

		// (D) Final fallback: blank the dedicated decoration component -----
		safe("AvatarDecoration component", () => {
			for (const mod of allByProps("AvatarDecoration")) {
				if (typeof mod?.AvatarDecoration === "function")
					track(instead("AvatarDecoration", mod, () => null));
			}
		});
	},

	onUnload() {
		for (const unpatch of patches) {
			try {
				unpatch();
			} catch {}
		}
		patches.length = 0;
	},
};
