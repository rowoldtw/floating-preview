---
status: done
native: false
area: Chrome
---

Each settings group (Look, Behaviour, Order) sits in one card, like Obsidian's own settings.

> [!use] Using it
> Settings → Muta. Each group's heading sits above its card.

> [!how] How it works
> `MutaSettings` builds each group with Obsidian's `SettingGroup` (`setHeading`, then `addSetting` per row) instead of a heading `Setting` followed by loose rows. `SettingGroup` arrived in Obsidian 1.11, so `minAppVersion` is now 1.11.0.
