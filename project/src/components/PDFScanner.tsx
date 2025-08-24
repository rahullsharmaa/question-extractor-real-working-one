import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Eye, Database, Zap, BookOpen, Calendar, X, ToggleLeft, ToggleRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { convertPdfToImages, performExtraction, ExtractedQuestion } from '../lib/gemini';
import { QuestionPreview } from './QuestionPreview';
import toast, { Toaster } from 'react-hot-toast';

interface Exam {
  id: string;
  name: string;
}

interface Course {
  id: string;
  name: string;
  exam_id: string;
}

interface PDFUpload {
  file: File | null;
  year: string;
  id: string;
}

export function PDFScanner() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedExam, setSelectedExam] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [pdfUploads, setPdfUploads] = useState<PDFUpload[]>(() => 
    Array.from({ length: 20 }, (_, i) => ({ file: null, year: '', id: `pdf-${i}` }))
  );
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(true);
  const [extractedQuestions, setExtractedQuestions] = useState<ExtractedQuestion[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [scanProgress, setScanProgress] = useState({ 
    currentPdf: 0, 
    totalPdfs: 0, 
    currentPage: 0, 
    totalPages: 0,
    pdfName: ''
  });
  const [pageMemory, setPageMemory] = useState<Map<number, string>>(new Map());

  React.useEffect(() => {
    loadExams();
  }, []);

  React.useEffect(() => {
    if (selectedExam) {
      loadCourses(selectedExam);
    }
  }, [selectedExam]);

  const loadExams = async () => {
    try {
      const { data, error } = await supabase
        .from('exams')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      setExams(data || []);
    } catch (error) {
      toast.error('Failed to load exams');
      console.error('Error loading exams:', error);
    }
  };

  const loadCourses = async (examId: string) => {
    try {
      const { data, error } = await supabase
        .from('courses')
        .select('id, name, exam_id')
        .eq('exam_id', examId)
        .order('name');
      
      if (error) throw error;
      setCourses(data || []);
    } catch (error) {
      toast.error('Failed to load courses');
      console.error('Error loading courses:', error);
    }
  };

  const createDropzoneHandlers = (index: number) => {
    const onDrop = useCallback((acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file && file.type === 'application/pdf') {
        setPdfUploads(prev => prev.map((upload, i) => 
          i === index ? { ...upload, file } : upload
        ));
        toast.success(`PDF ${index + 1} uploaded successfully!`);
      } else {
        toast.error('Please upload a PDF file');
      }
    }, [index]);

    return useDropzone({
      onDrop,
      accept: {
        'application/pdf': ['.pdf']
      },
      multiple: false
    });
  };

  const removePdf = (index: number) => {
    setPdfUploads(prev => prev.map((upload, i) => 
      i === index ? { ...upload, file: null, year: '' } : upload
    ));
  };

  const updateYear = (index: number, year: string) => {
    setPdfUploads(prev => prev.map((upload, i) => 
      i === index ? { ...upload, year } : upload
    ));
  };

  const getValidPdfs = () => {
    return pdfUploads.filter(upload => upload.file && upload.year.trim() !== '');
  };

  const scanAndExtractQuestions = async () => {
    const validPdfs = getValidPdfs();
    
    if (validPdfs.length === 0 || !selectedExam || !selectedCourse) {
      toast.error('Please select exam/course and upload at least one PDF with year');
      return;
    }

    setIsScanning(true);
    setExtractedQuestions([]);
    setScanProgress({ currentPdf: 0, totalPdfs: validPdfs.length, currentPage: 0, totalPages: 0, pdfName: '' });

    const allExtractedQuestions: ExtractedQuestion[] = [];

    for (let pdfIndex = 0; pdfIndex < validPdfs.length; pdfIndex++) {
      const pdfUpload = validPdfs[pdfIndex];
      const { file, year } = pdfUpload;
      
      setScanProgress(prev => ({ 
        ...prev, 
        currentPdf: pdfIndex + 1, 
        pdfName: file!.name,
        currentPage: 0,
        totalPages: 0
      }));

      try {
        toast.success(`Converting PDF ${pdfIndex + 1}/${validPdfs.length} to images...`);
        
        // Convert PDF to images
        const images = await convertPdfToImages(file!);
        setScanProgress(prev => ({ ...prev, totalPages: images.length }));
        
        toast.success(`Processing ${images.length} pages of PDF ${pdfIndex + 1} with AI vision...`);

        const pdfQuestions: ExtractedQuestion[] = [];
        let previousContext = '';
        const currentPdfMemory = new Map<number, string>();

        // Process each page
        for (let i = 0; i < images.length; i++) {
          const pageNum = i + 1;
          setScanProgress(prev => ({ ...prev, currentPage: pageNum }));

          try {
            toast(`🔍 PDF ${pdfIndex + 1}: Analyzing page ${pageNum}/${images.length}...`, { duration: 2000 });
            
            const questions = await performExtraction(images[i], pageNum, previousContext, currentPdfMemory);

            if (questions.length > 0) {
              pdfQuestions.push(...questions);
              previousContext = questions.map(q => q.question_statement).join(' ');
              toast.success(`✅ Found ${questions.length} questions on page ${pageNum}`);
            } else {
              toast(`📄 Page ${pageNum}: Instructions/Non-question content`, { duration: 1000 });
            }

          } catch (pageError) {
            console.error(`Error processing page ${pageNum}:`, pageError);
            toast.error(`❌ Failed to process page ${pageNum}: ${pageError.message}`);
            // Continue to next page instead of stopping
          }

          // Delay between pages
          if (i < images.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        }

        // Add questions from this PDF to the total
        allExtractedQuestions.push(...pdfQuestions);

        if (pdfQuestions.length > 0) {
          toast.success(`🎉 PDF ${pdfIndex + 1}: Extracted ${pdfQuestions.length} questions!`);
          
          // Auto-save if enabled
          if (autoSaveEnabled) {
            await savePdfQuestions(pdfQuestions, year);
            toast.success(`💾 PDF ${pdfIndex + 1}: Questions saved to database!`);
          }
        } else {
          toast.error(`❌ PDF ${pdfIndex + 1}: No questions found`);
        }

        // Delay between PDFs
        if (pdfIndex < validPdfs.length - 1) {
          toast(`⏳ Preparing next PDF...`, { duration: 2000 });
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

      } catch (error) {
        console.error(`Error processing PDF ${pdfIndex + 1}:`, error);
        toast.error(`❌ PDF ${pdfIndex + 1} failed: ${error.message}`);
      }
    }

    setExtractedQuestions(allExtractedQuestions);
    
    if (allExtractedQuestions.length > 0) {
      toast.success(`🎉 Total: ${allExtractedQuestions.length} questions extracted from ${validPdfs.length} PDFs!`);
    }

    setIsScanning(false);
    setScanProgress({ currentPdf: 0, totalPdfs: 0, currentPage: 0, totalPages: 0, pdfName: '' });
  };

  const deleteQuestion = (index: number) => {
    setExtractedQuestions(prev => prev.filter((_, i) => i !== index));
    toast.success('Question deleted successfully');
  };

  const updateQuestionImage = (index: number, imageBase64: string) => {
    setExtractedQuestions(prev => prev.map((q, i) => 
      i === index ? { ...q, uploaded_image: imageBase64 } : q
    ));
    toast.success('Image added to question');
  };

  const savePdfQuestions = async (questions: ExtractedQuestion[], year: string) => {
    const questionsToInsert = questions.map(q => ({
      question_type: q.question_type,
      question_statement: q.question_statement,
      options: q.options && q.options.length > 0 ? q.options : null,
      course_id: selectedCourse,
      year: parseInt(year),
      categorized: false,
    }));

    const validQuestions = questionsToInsert.filter(q => 
      q.question_statement && 
      q.question_statement.trim().length > 0 &&
      q.question_type &&
      ['MCQ', 'MSQ', 'NAT', 'Subjective'].includes(q.question_type) &&
      q.course_id &&
      q.year && q.year > 2000 && q.year < 2030
    );

    if (validQuestions.length === 0) {
      throw new Error('No valid questions to save');
    }

    const { data, error } = await supabase
      .from('questions')
      .insert(validQuestions)
      .select();

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  };

  const saveAllToDatabase = async () => {
    if (!selectedCourse || extractedQuestions.length === 0) {
      toast.error('Please select course and extract questions first');
      return;
    }

    setIsSaving(true);
    
    try {
      toast.loading('💾 Saving questions to database...', { id: 'saving' });
      
      // Group questions by year for batch insertion
      const questionsByYear = new Map<string, ExtractedQuestion[]>();
      extractedQuestions.forEach(q => {
        const year = q.page_number?.toString() || 'unknown';
        if (!questionsByYear.has(year)) {
          questionsByYear.set(year, []);
        }
        questionsByYear.get(year)!.push(q);
      });

      let totalSaved = 0;
      for (const [year, questions] of questionsByYear) {
        const data = await savePdfQuestions(questions, year);
        totalSaved += data?.length || 0;
      }

      toast.dismiss('saving');
      toast.success(`🎉 Successfully saved ${totalSaved} questions to database!`);
      setExtractedQuestions([]);
      setPdfUploads(Array.from({ length: 20 }, (_, i) => ({ file: null, year: '', id: `pdf-${i}` })));
      setSelectedExam('');
      setSelectedCourse('');
      
    } catch (error) {
      console.error('Error saving questions:', error);
      toast.dismiss('saving');
      toast.error(`❌ Failed to save questions: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const validPdfs = getValidPdfs();

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50">
      <Toaster position="top-right" />
      
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-4 rounded-2xl shadow-lg">
              <Zap className="w-12 h-12 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent mb-4">
            Super Advanced PDF Scanner
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            AI-powered vision system that scans every page and extracts all questions with perfect accuracy
          </p>
          
          {/* Features */}
          <div className="flex items-center justify-center gap-8 mt-8 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-purple-500" />
              <span>Vision AI</span>
            </div>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-500" />
              <span>Page-by-Page Scanning</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-green-500" />
              <span>KaTeX Support</span>
            </div>
          </div>
        </div>

        {/* Selection Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Exam Selection */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <BookOpen className="w-4 h-4" />
                Select Exam
              </label>
              <select
                value={selectedExam}
                onChange={(e) => setSelectedExam(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              >
                <option value="">Choose an exam...</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Course Selection */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <Database className="w-4 h-4" />
                Select Course
              </label>
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                disabled={!selectedExam}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all disabled:bg-gray-50"
              >
                <option value="">Choose a course...</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Auto-save Toggle */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <Database className="w-4 h-4" />
                Auto-save & Continue
              </label>
              <button
                onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                  autoSaveEnabled 
                    ? 'bg-green-50 border-green-200 text-green-700' 
                    : 'bg-gray-50 border-gray-200 text-gray-500'
                }`}
              >
                {autoSaveEnabled ? (
                  <ToggleRight className="w-6 h-6 text-green-600" />
                ) : (
                  <ToggleLeft className="w-6 h-6 text-gray-400" />
                )}
                <span className="font-medium">
                  {autoSaveEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Multi-PDF Upload Areas */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Upload PDFs (Up to 20)</h2>
            <p className="text-gray-600">Upload multiple PDFs with their respective years. They will be processed one by one.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pdfUploads.slice(0, 12).map((upload, index) => {
              const { getRootProps, getInputProps, isDragActive } = createDropzoneHandlers(index);
              
              return (
                <div key={upload.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">PDF {index + 1}</span>
                    {upload.file && (
                      <button
                        onClick={() => removePdf(index)}
                        className="text-red-500 hover:text-red-700 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  
                  <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-lg p-4 text-center transition-all cursor-pointer mb-3 ${
                      isDragActive
                        ? 'border-purple-400 bg-purple-50'
                        : upload.file
                        ? 'border-green-400 bg-green-50'
                        : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
                    }`}
                  >
                    <input {...getInputProps()} />
                    <div className="flex flex-col items-center">
                      <Upload className={`w-6 h-6 mb-2 ${upload.file ? 'text-green-600' : 'text-gray-400'}`} />
                      {upload.file ? (
                        <div>
                          <p className="text-sm font-medium text-green-800 truncate max-w-full">
                            {upload.file.name}
                          </p>
                          <p className="text-xs text-green-600">Ready to scan</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm text-gray-600">Drop PDF or click</p>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="flex items-center gap-2 text-xs font-medium text-gray-700 mb-2">
                      <Calendar className="w-3 h-3" />
                      Year
                    </label>
                    <input
                      type="number"
                      value={upload.year}
                      onChange={(e) => updateYear(index, e.target.value)}
                      placeholder="2019"
                      min="2000"
                      max="2030"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          
          {validPdfs.length > 0 && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-blue-800 font-medium">
                📊 Ready to process: {validPdfs.length} PDFs
              </p>
              <p className="text-blue-600 text-sm mt-1">
                Auto-save is {autoSaveEnabled ? 'enabled' : 'disabled'}
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 justify-center mb-8">
          <button
            onClick={scanAndExtractQuestions}
            disabled={validPdfs.length === 0 || isScanning || !selectedExam || !selectedCourse}
            className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <Eye className="w-5 h-5" />
            {isScanning ? '🔍 Scanning PDFs...' : `🚀 Scan ${validPdfs.length} PDFs`}
          </button>

          {!autoSaveEnabled && (
            <button
              onClick={saveAllToDatabase}
              disabled={extractedQuestions.length === 0 || isSaving || !selectedCourse}
              className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              <Database className="w-5 h-5" />
              {isSaving ? '💾 Saving...' : '💾 Save All to Database'}
            </button>
          )}
        </div>

        {/* Progress Indicator */}
        {isScanning && scanProgress.totalPdfs > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium text-blue-900">🤖 Processing PDFs</h3>
                <span className="text-sm font-medium text-blue-700">
                  PDF {scanProgress.currentPdf}/{scanProgress.totalPdfs}
                </span>
              </div>
              <p className="text-sm text-blue-600 mb-3">
                📄 Current: {scanProgress.pdfName}
              </p>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
              <div
                className="bg-gradient-to-r from-purple-600 to-indigo-600 h-3 rounded-full transition-all duration-300"
                style={{
                  width: `${(scanProgress.currentPdf / scanProgress.totalPdfs) * 100}%`
                }}
              />
            </div>
            
            {scanProgress.totalPages > 0 && (
              <p className="text-sm text-blue-600">
                🔍 Page {scanProgress.currentPage}/{scanProgress.totalPages} of current PDF
              </p>
            )}
          </div>
        )}

        {/* Questions Preview */}
        {extractedQuestions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                🎉 All Extracted Questions ({extractedQuestions.length})
              </h2>
              <div className="text-sm text-gray-500">
                {autoSaveEnabled ? 'Auto-saved to database' : 'Ready to save to database'}
              </div>
            </div>
            
            <div className="space-y-6">
              {extractedQuestions.map((question, index) => (
                <QuestionPreview
                  key={index}
                  question={question}
                  index={index + 1}
                  onDelete={() => deleteQuestion(index)}
                  onImageUpload={(imageBase64) => updateQuestionImage(index, imageBase64)}
                  showControls={!autoSaveEnabled}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}