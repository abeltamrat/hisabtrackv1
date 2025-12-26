import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';

export async function saveWorkbook(filename: string, wb: XLSX.WorkBook) {
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, filename);
}

export async function saveCSV(filename: string, csvContent: string) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, filename);
}

export async function saveJSON(filename: string, jsonContent: string) {
    const blob = new Blob([jsonContent], { type: 'application/json' });
    saveAs(blob, filename);
}
