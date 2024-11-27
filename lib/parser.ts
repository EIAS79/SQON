import * as fs from 'fs';
import * as readline from 'readline';
import  { SQONSchema } from './extends/schema';
import { SQONValidation } from './extends/parseValidation';
import { SQONRecords } from './extends/parseRecords';
import { Validator } from './extends/validator';
import { ParsingMetadata, AllowedTypes, ParsedResult, ParserConfig, Document } from './types/general';
import { ValidateParams, ValidationResult } from './types/validator';


/**
 * Represents the main class for handling SQON data parsing, validation, and conversion.
 * It processes input files, validates them against defined rules, and tracks the parsing metadata.
 * 
 * @class SQON
 * @param {ParserConfig} config - Configuration for parsing SQON data.
 * @param {string} config.filePath - Path to the SQON file to parse.
 * @param {('schema' | 'validations' | 'records')} [config.section] - Optional section to focus on during parsing.
 */
export class SQON {
    private section?: 'schema' | 'records';
    private filePath?: string; // Optional
    private fileContent?: string; // Optional
    private parsingStartTime: number;
    private sectionStartTime: number;
    private metadata: ParsingMetadata;
    lines: string[];
    position: number;
    parsedSchema: Record<string, any>;
    validations: Record<string, any> = {};
    records: Document[];
    allowedTypes: string[];
    validationKeywords: Record<string, AllowedTypes[]>;
    errors: { line: number | null; message: string }[];
    sectionOrder: string[];
    fileRules: { Strict: boolean }; 
    MAX_ERRORS: number; 

    /**
     * Constructs an instance of the SQON parser and initializes its properties.
     * 
     * @param {ParserConfig} config - The configuration object for parsing the file.
     * @param {string} config.filePath - Path to the SQON file that will be parsed.
     * @param {('schema' | 'validations' | 'records')} [config.section] - The specific section to focus on during parsing (optional).
     */
    constructor({ filePath, section, fileContent }: ParserConfig) {
        if (!filePath && !fileContent) {
            throw new Error(
                "Invalid configuration: At least one of 'filePath' or 'fileContent' must be provided."
            );
        }
        this.filePath = filePath;
        this.fileContent = fileContent;
        this.section = section;
        this.lines = [];
        this.position = 0;
        this.parsedSchema = {};
        this.validations = {};
        this.records = [];
        this.MAX_ERRORS = 50;
        this.allowedTypes = [
            'Number', 'String', 'Binary', 'Date', 'Boolean', 'Uint8Array', 'Binary',
            'Object', 'Any[]', 'StringArray', 'ObjectArray', 'NumberArray',
            'Number[]', 'String[]', 'Object[]', 'Null', 'undefined', 'Array',
            '[]', 'Any', 'AnyArray',
        ];
        this.validationKeywords = {
            'custom': ['Any'],
            'default': ['Any'],
            'isNull': ['Any'], 
            'min': ['Number', 'NumberArray', 'Uint8Array'],
            'max': ['Number', 'NumberArray', 'Uint8Array'],
            'minLength': ['String', 'StringArray', 'ObjectArray', 'Array', 'Object', 'NumberArray', 'Uint8Array'],
            'maxLength': ['String', 'StringArray', 'ObjectArray', 'Array', 'Object', 'NumberArray', 'Uint8Array'],
            'maxSize': ['Binary', 'Array', 'StringArray', 'NumberArray', 'ObjectArray', 'Object', 'Uint8Array'],
            'required': ['Any'], 
            'isEqualTo': ['Any'],
            'isDate': ['Date'],
            'isPositive': ['Number', 'NumberArray', 'Uint8Array'],
            'isNegative': ['Number', 'NumberArray', 'Uint8Array'],
            'isUnique': ['Any'], 
            'hasProperties': ['Object', 'ObjectArray'], 
            'notNull': ['Any'],
            'pattern': ['String'],
            'isEmail': ['String', 'StringArray'],
            'isURL': ['String'],
            'isAlpha': ['String'],
            'isNumeric': ['String'],
            'isAlphanumeric': ['String'],
            'isInteger': ['Number'],
            'isFloat': ['Number'],
            'isBoolean': ['Boolean'],
            'isIP': ['String'],
            'enum': ['Any'],
            'minDate': ['Date'],
            'maxDate': ['Date'],
            'matchesField': ['Any'],
            'trim': ['String'],
            'lowercase': ['String'],
            'uppercase': ['String']
        };
        this.errors = [];
        this.sectionOrder = [];
        this.fileRules = { Strict: false };
        this.parsingStartTime = 0;
        this.sectionStartTime = 0;
        this.metadata = {
            timeTaken: '0 seconds',
            recordCount: 0,
            schemaFieldCount: 0,
            validationRuleCount: 0,
            fileSize: '0 bytes',
            averageRecordSize: '0 byetes',
            timestamp: new Date().toLocaleString(),
            memoryUsage: {
                heapTotal: '0 MB',
                heapUsed: '0 MB',
                external: '0 MB',
            },
            sections: {
                schema: { timeMs: 0 },
                validations: { timeMs: 0 },
                records: { timeMs: 0 }
            }
        };
    }

    /**
     * Main method that handles the parsing of the SQON file, processes sections, and gathers metadata.
     * It reads the file, processes its sections, and returns parsed results along with metadata.
     *
     * @async
     * @returns {Promise<ParsedResult>} - A promise that resolves to the parsed results, including metadata and errors.
     */
    async parse(): Promise<ParsedResult> {
        const formatFileSize = (size: number): string => {
            if (size < 1024) return `${size.toFixed(2)} bytes`;
            if (size < 1048576) return `${(size / 1024).toFixed(2)} KB`;
            if (size < 1073741824) return `${(size / 1048576).toFixed(2)} MB`;
            return `${(size / 1073741824).toFixed(2)} GB`;
        };

        const formatTime = (ms: number): string => `${(ms / 1000).toFixed(2)} seconds`;

        this.parsingStartTime = performance.now();

        if (this.fileContent) {
            // Parse from content string
            this.lines = this.fileContent
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
        } else if (this.filePath) {
            // Parse from file at given path
            const stats = await fs.promises.stat(this.filePath!);
            this.metadata.fileSize = formatFileSize(stats.size);

            const fileStream = fs.createReadStream(this.filePath!);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                const trimmedLine = line.trim();
                if (trimmedLine) {
                    this.lines.push(trimmedLine);
                }
            }
        }

        const result = this.parseLines();

        const parsingEndTime = performance.now();
        this.metadata.timeTaken = formatTime(parsingEndTime - this.parsingStartTime);
        this.metadata.recordCount = this.records.length;
        this.metadata.schemaFieldCount = Object.keys(this.parsedSchema).length;
        this.metadata.validationRuleCount = Object.keys(this.validations).length;

        this.metadata.averageRecordSize =
            this.records.length > 0
                ? formatFileSize(this.lines.join('\n').length / this.records.length)
                : '0 bytes';

        const memoryUsage = process.memoryUsage();
        this.metadata.memoryUsage = {
            heapTotal: formatFileSize(memoryUsage.heapTotal),
            heapUsed: formatFileSize(memoryUsage.heapUsed),
            external: formatFileSize(memoryUsage.external),
        };

        return {
            ...result,
            metadata: this.metadata,
        };
    }

    /**
     * Parses the lines of the SQON file and processes the different sections.
     * It reads through the file and determines what sections need to be processed (schema, validations, records).
     * It updates the `position` and `lines` and handles section-specific logic.
     * 
     * @returns {ParsedResult} - The parsed result, including schema, validations, records, and errors.
     */
    private parseLines(): ParsedResult {
        while (this.position < this.lines.length) {
            const line = this.lines[this.position];
    
            if (line.startsWith('*STRICT=')) {
                const strictValue = line.split('=')[1]?.trim().toUpperCase();
                if (strictValue === 'TRUE') {
                    if (this.section) throw new Error("Strict-Mode is enabled, please turn it off.");
                    this.fileRules.Strict = true;
                } else if (strictValue === 'FALSE') {
                     this.fileRules.Strict = false; 
                } else {
                    this.errors.push({ line: this.position + 1, message: `Invalid *STRICT value: ${strictValue}. Expected TRUE or FALSE.` });
                }
                    this.position++;
                    continue;
            }
            
            if (line === "@schema") {
                if (this.section === 'schema') {
                    this.position++;
                    this.parseSchema();
                    return { fileRules: this.fileRules, schema: this.parsedSchema, validations: {}, records: [], errors: this.errors };
                } else if (!this.section) {
                    this.checkSectionOrder("@schema");
                    this.position++;
                    this.parseSchema();
                }
            } else if (line === "@validations") {
                if (this.section === 'schema') {
                    this.position++;
                    this.parseValidation();
                    return { fileRules: this.fileRules, schema: {}, validations: this.validations, records: [], errors: this.errors };
                } else if (!this.section) {
                    this.checkSectionOrder("@validations");
                    this.position++;
                    this.parseValidation();
                }
            } else if (line === "@records") {
                if (this.section === 'records') {
                    this.position++;
                    this.parseRecords();
                    return { fileRules: this.fileRules, schema: {}, validations: {}, records: this.records, errors: this.errors };
                } else if (!this.section) {
                    this.checkSectionOrder("@records");
                    this.position++;
                    this.parseRecords();
                }
            } else if (line === "@end") {
                if (!this.section) {
                    if (this.sectionOrder.length === 0) {
                        this.errors.push({ line: this.position + 1, message: `Unexpected '@end' without an open section.` });
                    } else {
                        const lastSection = this.sectionOrder.pop();
                        if (lastSection !== '@schema' && lastSection !== '@validations' && lastSection !== '@records') {
                            this.errors.push({ line: this.position + 1, message: `Unexpected '@end' for section: ${lastSection}.` });
                        }
                    }
                }
            } else {
                if (this.section && this.section !== 'records' && this.section !== 'schema') throw new Error(`Invalid section parsing!`);
                if (!this.section) this.errors.push({ line: this.position + 1, message: `Unknown section or command: "${line}"` });
            }
    
            this.position++;
        }
    
        if (!this.section) {
            if (!this.parsedSchema) {
                this.errors.push({ line: null, message: `Missing required section: '@schema'` });
            }
            if (this.records.length === 0) {
                this.errors.push({ line: null, message: `Missing required section: '@records'` });
            }
        }
    
        return {
            fileRules: this.fileRules,
            schema: this.parsedSchema,
            validations: this.validations,
            records: this.records,
            errors: this.errors,
        };
    }    
    
    /**
     * Checks and enforces the order of sections within the SQON file.
     * Ensures that sections like `@schema`, `@validations`, and `@records` follow a specific order.
     * 
     * @param {string} section - The section name that is being processed (e.g., '@schema', '@validations', '@records').
     */
    private checkSectionOrder(section: string): void {
        if (section === "@schema") {
            if (this.sectionOrder.includes("@schema")) {
                this.errors.push({ line: this.position + 1, message: `'@schema' is already opened but not closed.` });
            }
            this.sectionOrder.push(section);
        } else if (section === "@validations") {
            if (!this.sectionOrder.includes("@schema")) {
                this.errors.push({ line: this.position + 1, message: `'@validations' must come after '@schema'.` });
            }
            if (this.sectionOrder.includes("@validations")) {
                this.errors.push({ line: this.position + 1, message: `'@validations' is already opened but not closed.` });
            }
            this.sectionOrder.push(section);
        } else if (section === "@records") {
            if (!this.sectionOrder.includes("@schema")) {
                this.errors.push({ line: this.position + 1, message: `'@records' must come after '@schema'.` });
            }
            if (this.sectionOrder.includes("@validations") && !this.sectionOrder.includes("@validations")) {
                this.errors.push({ line: this.position + 1, message: `'@records' must come after '@validations'.` });
            }
            if (this.sectionOrder.includes("@records")) {
                this.errors.push({ line: this.position + 1, message: `'@records' is already opened but not closed.` });
            }
            this.sectionOrder.push(section);
        }
    }

    /**
     * Parses the `@schema` section of the SQON file.
     * This method processes the schema lines, validates the schema fields, and populates the `parsedSchema` property.
     * 
     * @returns {void} - No return value. Updates the `parsedSchema` and `errors` properties of the instance.
     */
    private parseSchema(): void {
        this.sectionStartTime = performance.now();
        const schemaParser = new SQONSchema({ lines: this.lines, position: this.position, allowedTypes: this.allowedTypes });
        const results = schemaParser.parseSchema();
        this.metadata.sections.schema.timeMs = performance.now() - this.sectionStartTime;
        
        this.parsedSchema = results.parsedSchema;
        this.errors.push(...results.errors.slice(0, this.MAX_ERRORS));
        this.lines = results.lines;
        this.position = results.position;
    }

    /**
     * Parses the `@validations` section of the SQON file.
     * This method processes the validation rules, validates them against the schema, and populates the `validations` property.
     * 
     * @returns {void} - No return value. Updates the `validations` and `errors` properties of the instance.
     */
    private parseValidation(): void {
        this.sectionStartTime = performance.now();
        const validationParser = new SQONValidation({ 
            lines: this.lines, 
            position: this.position, 
            parsedSchema: this.parsedSchema, 
            validationKeywords: this.validationKeywords 
        });
        const results = validationParser.parseValidation();
        this.metadata.sections.validations.timeMs = performance.now() - this.sectionStartTime;
        this.validations = results.validations;
        this.errors.push(...results.errors.slice(0, this.MAX_ERRORS));
        this.lines = results.lines;
        this.position = results.position;
    }

    /**
     * Parses the `@records` section of the SQON file.
     * This method processes the records and stores them in the `records` property.
     * 
     * @returns {void} - No return value. Updates the `records` and `errors` properties of the instance.
     */
    private parseRecords(): void {
        this.sectionStartTime = performance.now();
        const recordParser = new SQONRecords(this.lines, this.position);
        const results = recordParser.parseRecords(500);
        this.metadata.sections.records.timeMs = performance.now() - this.sectionStartTime;
        this.errors.push(...results.errors.slice(0, this.MAX_ERRORS));
        this.records = results.records;
        this.position = results.position;
    }
    
    /**
     * Reprocesses and optionally updates the document by renumbering the records in the `@records` section.
     * If `content` is provided, it will use that content, otherwise, it will read from the file.
     * 
     * @async
     * @param {string} [content] - Optional content to process. If not provided, the method will read from the file.
     * @returns {Promise<string | void>} - Returns the updated content if `content` is provided, or writes the updates back to the file.
     */
    async redoc(content?: string): Promise<string | void> {
        try {
            const fileContent = content ?? (await fs.promises.readFile(this.filePath!, 'utf8'));
    
            const lines = fileContent.split('\n');
            let inRecordsSection = false;
            let newDocNumber = 0;
            const updatedLines: string[] = [];
    
            for (const line of lines) {
                if (line.trim() === '@records') {
                    inRecordsSection = true;
                    updatedLines.push(line);
                } else if (line.trim() === '@end' && inRecordsSection) {
                    inRecordsSection = false;
                    updatedLines.push(line);
                } else if (inRecordsSection && line.trim().startsWith('#')) {
                    const updatedLine = line.replace(/^#\d+/, `#${newDocNumber}`);
                    updatedLines.push(updatedLine);
                    newDocNumber++;
                } else {
                    updatedLines.push(line);
                }
            }
    
            const updatedContent = updatedLines.join('\n');
    
            if (content) {
                return updatedContent;
            } else {
                await fs.promises.writeFile(this.filePath!, updatedContent, 'utf8');
            }
        } catch (error) {
            console.error('Error fixing document numbers:', error);
            throw error;
        }
    }
    

    /**
     * Validates the given data against the provided schema and validation rules.
     * This method checks the data for compliance with the schema and validation rules and returns the results.
     * 
     * @async
     * @param {ValidateParams} params - The validation parameters.
     * @param {Record<string, any>} params.schema - The schema to validate the data against.
     * @param {boolean} params.validateData - Flag indicating whether the data should be validated.
     * @param {any} params.data - The data to validate.
     * @param {boolean} [params.strict] - Whether strict validation should be enforced (optional).
     * @returns {Promise<ValidationResult>} - A promise that resolves to the validation results.
     */
    async validateData({ schema, validateData, data, strict }: ValidateParams): Promise<ValidationResult> {
      const validate = new Validator()

      const result = await validate.validate({
        schema,
        validateData,
        data,
        strict
      });
    
      return result
    }
}
