// SPDX-License-Identifier: LicenseRef-Proprietary
// Prevents the console window flashing on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    the_box_lib::run()
}
