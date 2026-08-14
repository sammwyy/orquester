use super::HostEntryDef;

pub const EXPLORERS: &[HostEntryDef] = &[
    HostEntryDef { id: "nautilus", name: "Files (Nautilus)", bin: &["nautilus"] },
    HostEntryDef { id: "dolphin", name: "Dolphin", bin: &["dolphin"] },
    HostEntryDef { id: "thunar", name: "Thunar", bin: &["thunar"] },
    HostEntryDef { id: "nemo", name: "Nemo", bin: &["nemo"] },
    HostEntryDef { id: "pcmanfm", name: "PCManFM", bin: &["pcmanfm"] },
    HostEntryDef { id: "caja", name: "Caja", bin: &["caja"] },
    HostEntryDef { id: "explorer", name: "Explorer", bin: &["explorer"] },
    HostEntryDef { id: "system-files", name: "Open Directory", bin: &[] },
];
