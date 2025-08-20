use calamine::{open_workbook, DataType, Reader, Xlsx};
use serde::{Serialize, Deserialize};
use std::collections::HashSet;
use std::fs::File;
use std::io;

#[derive(Serialize, Deserialize)]
struct Tutor {
    id: String,
    name: String,
    available: bool,
    photo: String,
    grade: String,
    subjects: Vec<String>,
}

fn main() {
    println!("🚀 Starting tutor converter...");

    if let Err(e) = run() {
        match e.downcast_ref::<io::Error>() {
            Some(io_err) if io_err.kind() == io::ErrorKind::NotFound => {
                eprintln!("❌ ERROR: Could not find required file. Make sure `tutors.xlsx` is in the same folder as this program.");
            }
            _ => eprintln!("❌ ERROR: {}", e),
        }
        std::process::exit(1);
    }

    println!("✅ Program finished successfully!");
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let script_dir = std::env::current_dir()?;
    println!("📂 Current working directory: {:?}", script_dir);

    let xlsx_path = script_dir.join("tutors.xlsx");
    let json_path = script_dir.join("../backend/data/tutors.json");

    println!("🔍 Looking for Excel file at: {:?}", xlsx_path);
    println!("📝 Will save JSON output to: {:?}", json_path);

    // Open workbook
    let mut workbook: Xlsx<_> = open_workbook(&xlsx_path)
        .map_err(|_| format!("❌ ERROR: Failed to open Excel file: {:?}", xlsx_path))?;
    println!("✅ Successfully opened Excel file!");

    // Auto-detect first sheet
    let sheet_name = workbook
        .sheet_names()
        .get(0)
        .ok_or("❌ ERROR: No sheets found in the Excel file")?
        .to_string();
    println!("📄 Using sheet: {}", sheet_name);

    // Get range
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|_| format!("❌ ERROR: Failed to read sheet `{}`", sheet_name))?;
    println!("✅ Successfully read sheet with {} rows", range.height());

    let mut tutors_list: Vec<Tutor> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for (row_idx, row) in range.rows().enumerate().skip(1) {
        println!("➡️ Processing row {}", row_idx + 1);

        // ID
        let student_id = row.get(2)
            .map(|cell| match cell {
                DataType::Int(i) => i.to_string(),
                DataType::Float(f) => (*f as i64).to_string(),
                DataType::String(s) => s.trim().to_string(),
                _ => "Unknown_ID".to_string(),
            })
            .unwrap_or("Unknown_ID".to_string());

        println!("   👤 Student ID: {}", student_id);

        if seen_ids.contains(&student_id) {
            println!("   ⚠️ Duplicate ID found, skipping row {}", row_idx + 1);
            continue;
        }
        seen_ids.insert(student_id.clone());

        // Name
        let full_name = row.get(3)
            .and_then(|v| v.get_string())
            .unwrap_or("Unknown Name")
            .trim()
            .to_string();
        println!("   🏷️ Name: {}", full_name);

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

        // Subjects (columns 5..12, handle missing)
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

    println!("💾 Preparing to save {} tutors...", tutors_list.len());

    // Make sure parent directory exists
    if let Some(parent) = json_path.parent() {
        println!("📂 Ensuring directory exists: {:?}", parent);
        std::fs::create_dir_all(parent)?;
    }

    // Save JSON
    let file = File::create(&json_path)
        .map_err(|_| format!("❌ ERROR: Failed to create JSON file at {:?}", json_path))?;
    serde_json::to_writer_pretty(file, &tutors_list)?;

    println!("✅ Saved {} tutors to {:?}", tutors_list.len(), json_path);
    Ok(())
}
