use calamine::{open_workbook, DataType, Reader, Xlsx};
use serde::{Serialize, Deserialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{self, Write};

#[derive(Serialize, Deserialize)]
struct Tutor {
    id: String,
    name: String,
    available: bool,
    photo: String,
    grade: String,
    subjects: Vec<String>,
}

// Utility to keep console open on Windows
fn pause() {
    print!("Press ENTER to exit...");
    let _ = io::stdout().flush();
    let mut s = String::new();
    let _ = io::stdin().read_line(&mut s);
}

fn main() {
    println!("🚀 Starting tutor converter...");

    // Get current directory
    let script_dir = match std::env::current_dir() {
        Ok(path) => {
            println!("📂 Current directory: {:?}", path);
            path
        }
        Err(e) => {
            eprintln!("❌ ERROR: Could not get current directory: {}", e);
            pause();
            return;
        }
    };

    let xlsx_path = script_dir.join("tutors.xlsx");
    let json_path = script_dir.join("../backend/data/tutors.json");
    println!("🔍 Looking for Excel file at: {:?}", xlsx_path);
    println!("📄 Will save JSON file to: {:?}", json_path);

    // Open workbook
    let mut workbook: Xlsx<_> = match open_workbook(&xlsx_path) {
        Ok(wb) => {
            println!("✅ Successfully opened Excel file.");
            wb
        }
        Err(e) => {
            eprintln!("❌ ERROR: Failed to open Excel file at {:?}\n   Details: {}", xlsx_path, e);
            pause();
            return;
        }
    };

    // Find first sheet
    let sheet_name = match workbook.sheet_names().get(0) {
        Some(name) => {
            println!("📑 Using sheet: {}", name);
            name.to_string()
        }
        None => {
            eprintln!("❌ ERROR: No sheets found in workbook!");
            pause();
            return;
        }
    };

    // Get data range
    let range = match workbook.worksheet_range(&sheet_name) {
        Ok(r) => {
            println!("✅ Sheet loaded successfully.");
            r
        }
        Err(e) => {
            eprintln!("❌ ERROR: Could not read sheet '{}': {}", sheet_name, e);
            pause();
            return;
        }
    };

    let mut tutors_list: Vec<Tutor> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    println!("🔄 Processing rows...");

    for (i, row) in range.rows().skip(1).enumerate() {
        println!("➡️ Row {}:", i + 2);

        // ID
        let student_id = row.get(2)
            .map(|cell| match cell {
                DataType::Int(i) => i.to_string(),
                DataType::Float(f) => (*f as i64).to_string(),
                DataType::String(s) => s.trim().to_string(),
                _ => "Unknown_ID".to_string(),
            })
            .unwrap_or("Unknown_ID".to_string());
        println!("   🆔 ID: {}", student_id);

        if seen_ids.contains(&student_id) {
            println!("   ⚠️ Duplicate ID, skipping.");
            continue;
        }
        seen_ids.insert(student_id.clone());

        // Name
        let full_name = row.get(3)
            .and_then(|v| v.get_string())
            .unwrap_or("Unknown Name")
            .trim()
            .to_string();
        println!("   👤 Name: {}", full_name);

        // Grade
        let grade = row.get(4)
            .map(|cell| match cell {
                DataType::Int(i) => i.to_string(),
                DataType::Float(f) => (*f as i64).to_string(),
                DataType::String(s) => s.trim().to_string(),
                _ => "Unknown Grade".to_string(),
            })
            .unwrap_or("Unknown Grade".to_string());
        println!("   🎓 Grade: {}", grade);

        // Subjects
        let mut subjects = Vec::new();
        for cell in row.iter().skip(5).take(7) {
            if let Some(val) = cell.get_string() {
                let val = val.trim();
                if val.contains("  ") {
                    subjects.extend(val.split("  ").map(|s| s.trim().to_string()));
                } else if val.contains(',') {
                    subjects.extend(val.split(',').map(|s| s.trim().to_string()));
                } else if !val.is_empty() {
                    subjects.push(val.to_string());
                }
            }
        }
        println!("   📚 Subjects: {:?}", subjects);

        tutors_list.push(Tutor {
            id: student_id,
            name: full_name.clone(),
            available: false,
            photo: format!("{}.jpeg", full_name),
            grade,
            subjects,
        });
    }

    println!("💾 Saving {} tutors to {:?}", tutors_list.len(), json_path);

    match File::create(&json_path) {
        Ok(file) => {
            if let Err(e) = serde_json::to_writer_pretty(file, &tutors_list) {
                eprintln!("❌ ERROR: Failed to write JSON: {}", e);
                pause();
                return;
            }
        }
        Err(e) => {
            eprintln!("❌ ERROR: Could not create JSON file {:?}: {}", json_path, e);
            pause();
            return;
        }
    }

    println!("✅ Done! Saved {} tutors to {:?}", tutors_list.len(), json_path);
    pause();
}
