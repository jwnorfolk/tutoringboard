use calamine::{open_workbook, DataType, Reader, Xlsx};
use serde::{Serialize, Deserialize};
use std::collections::HashSet;
use std::fs::File;

#[derive(Serialize, Deserialize)]
struct Tutor {
    id: String,
    name: String,
    available: bool,
    photo: String,
    grade: String,
    subjects: Vec<String>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let script_dir = std::env::current_dir()?;
    let xlsx_path = script_dir.join("../tutors.xlsx");
    let json_path = script_dir.join("../../backend/data/tutors.json");

    let mut workbook: Xlsx<_> = open_workbook(&xlsx_path)?;

    // Auto-detect first sheet
    let sheet_name = workbook
        .sheet_names()
        .get(0)
        .ok_or("No sheets found")?
        .to_string();

    // Get range
    let range = workbook.worksheet_range(&sheet_name)?;

    let mut tutors_list: Vec<Tutor> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for row in range.rows().skip(1) {
        // ID
        let student_id = row.get(2)
            .map(|cell| match cell {
                DataType::Int(i) => i.to_string(),
                DataType::Float(f) => (*f as i64).to_string(),  // dereference float
                DataType::String(s) => s.trim().to_string(),
                _ => "Unknown_ID".to_string(),
            })
            .unwrap_or("Unknown_ID".to_string());

        if seen_ids.contains(&student_id) {
            continue;
        }
        seen_ids.insert(student_id.clone());

        // Name
        let full_name = row.get(3)
            .and_then(|v| v.get_string())
            .unwrap_or("Unknown Name")
            .trim()
            .to_string();

        // Grade
        let grade = row.get(4)
            .map(|cell| match cell {
                DataType::Int(i) => i.to_string(),
                DataType::Float(f) => (*f as i64).to_string(),  // dereference float
                DataType::String(s) => s.trim().to_string(),
                _ => "Unknown Grade".to_string(),
            })
            .unwrap_or("Unknown Grade".to_string());

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

        tutors_list.push(Tutor {
            id: student_id,
            name: full_name.clone(),
            available: false,
            photo: format!("{}.jpeg", full_name),
            grade,
            subjects,
        });
    }

    let file = File::create(&json_path)?;
    serde_json::to_writer_pretty(file, &tutors_list)?;

    println!("Saved {} tutors to {:?}", tutors_list.len(), json_path);
    Ok(())
}
