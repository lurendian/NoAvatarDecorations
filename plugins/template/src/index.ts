// NoAvatarDecorations
// A Revenge / Vendetta-compatible plugin that hides avatar decorations
// (the cosmetic frames Discord renders around avatars).
//
// Strategy: avatar decorations are resolved through a small set of helper
// functions and a dedicated render component. We neutralize every known
// entry point so the decoration is never resolved or drawn, regardless of
// where the avatar is shown (chat, member list, profiles, DMs, etc.).

import { findByProps, findByName } from "@vendetta/metro";
import { instead, after } from "@vendetta/patcher";

// Collected unpatch callbacks so onUnload can cleanly revert everything.
const patches: Array<() => void> = [];

function tryPatch(label: string, fn: () => (() => void) | undefined | null) {
	try {
		const unpatch = fn();
		if (unpatch) patches.push(unpatch);
	} catch (err) {
		console.log(`[NoAvatarDecorations] failed to apply patch "${label}":`, err);
	}
}

export default {
	onLoad() {
		// 1) URL resolvers ---------------------------------------------------
		// Most surfaces ask a util module for the decoration asset URL.
		// Returning null short-circuits rendering in those surfaces.
		const AvatarUtils = findByProps("getAvatarDecorationURL");
		if (AvatarUtils?.getAvatarDecorationURL) {
			tryPatch("getAvatarDecorationURL", () =>
				instead("getAvatarDecorationURL", AvatarUtils, () => null),
			);
		}

		const AvatarUtils2 = findByProps("getUserAvatarDecorationURL");
		if (AvatarUtils2?.getUserAvatarDecorationURL) {
			tryPatch("getUserAvatarDecorationURL", () =>
				instead("getUserAvatarDecorationURL", AvatarUtils2, () => null),
			);
		}

		// 2) Strip decoration data from user objects -------------------------
		// Some components read `user.avatarDecorationData` directly instead of
		// going through a URL helper. Blank it out as the user records flow
		// through the UserStore.
		const UserStore = findByProps("getUser", "getCurrentUser");
		if (UserStore?.getUser) {
			const strip = (user: any) => {
				if (user && user.avatarDecorationData) {
					try {
						user.avatarDecorationData = null;
					} catch {}
				}
				return user;
			};
			tryPatch("UserStore.getUser", () =>
				after("getUser", UserStore, (_args, user) => strip(user)),
			);
			tryPatch("UserStore.getCurrentUser", () =>
				after("getCurrentUser", UserStore, (_args, user) => strip(user)),
			);
		}

		// 3) Render component fallback --------------------------------------
		// As a last line of defense, force the decoration render component to
		// render nothing.
		const Decoration =
			findByName("AvatarDecoration", false) ??
			findByName("AvatarDecoration");
		if (Decoration) {
			const target = Decoration.default ? Decoration : { default: Decoration };
			if (typeof target.default === "function") {
				tryPatch("AvatarDecoration render", () =>
					instead("default", target, () => null),
				);
			}
		}
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
