/**
 * Report writer - generates JSON and Markdown reports from review results.
 */
import type { ReviewRun } from "./models.js";
export declare function writeReports(run: ReviewRun, outputDir: string): string;
