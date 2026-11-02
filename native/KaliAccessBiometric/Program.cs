using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using DPUruNet;

namespace KaliAccessBiometric
{
    public class CandidateDto
    {
        [JsonPropertyName("id")]
        public string Id { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("template")]
        public string Template { get; set; }
    }

    public class IdentifyRequestDto
    {
        [JsonPropertyName("sample")]
        public string Sample { get; set; }

        [JsonPropertyName("candidates")]
        public List<CandidateDto> Candidates { get; set; }

        [JsonPropertyName("threshold")]
        public int? Threshold { get; set; }
    }

    public class VerifyRequestDto
    {
        [JsonPropertyName("sample")]
        public string Sample { get; set; }

        [JsonPropertyName("target")]
        public string Target { get; set; }

        [JsonPropertyName("threshold")]
        public int? Threshold { get; set; }
    }

    class Program
    {
        // Default False Accept Rate (FAR) threshold calibrated for DigitalPersona U.are.U readers
        // 21474 represents FAR = 1/100,000 (0.001%) where PROBABILITY_ONE = int.MaxValue (0x7FFFFFFF)
        private const int DEFAULT_THRESHOLD = 21474;

        static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.InputEncoding = Encoding.UTF8;

            if (args.Length == 0)
            {
                OutputJson(new { success = false, error = "NO_COMMAND", message = "Uso: KaliAccessBiometric.exe [check | capture | identify | verify]" });
                return 1;
            }

            string command = args[0].ToLowerInvariant().Trim();

            try
            {
                switch (command)
                {
                    case "check":
                    case "status":
                    case "is-available":
                        return HandleCheck();

                    case "capture":
                        int timeoutSec = 12;
                        for (int i = 1; i < args.Length; i++)
                        {
                            if (args[i] == "--timeout" && i + 1 < args.Length && int.TryParse(args[i + 1], out int t))
                            {
                                timeoutSec = Math.Max(2, Math.Min(60, t));
                            }
                        }
                        return HandleCapture(timeoutSec);

                    case "identify":
                        return HandleIdentify(args);

                    case "verify":
                        return HandleVerify(args);

                    default:
                        OutputJson(new { success = false, error = "UNKNOWN_COMMAND", message = $"Comando no reconocido: {command}" });
                        return 1;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[FATAL] Error en comando {command}: {ex}");
                OutputJson(new { success = false, error = "SYSTEM_EXCEPTION", message = ex.Message });
                return 1;
            }
        }

        private static int HandleCheck()
        {
            try
            {
                ReaderCollection readers = ReaderCollection.GetReaders();
                if (readers == null || readers.Count == 0)
                {
                    OutputJson(new
                    {
                        success = true,
                        available = false,
                        count = 0,
                        readers = new object[0],
                        message = "No se detectó ningún lector biométrico DigitalPersona conectado por USB."
                    });
                    return 0;
                }

                var readerList = new List<object>();
                foreach (Reader r in readers)
                {
                    readerList.Add(new
                    {
                        name = r.Description.Name ?? "DigitalPersona U.are.U Reader",
                        serial = r.Description.SerialNumber ?? "N/A",
                        modality = r.Description.Modality.ToString(),
                        technology = r.Description.Technology.ToString(),
                        id = $"{r.Description.Id.VendorId}:{r.Description.Id.ProductId}",
                        vendor = r.Description.Id.VendorName ?? "",
                        product = r.Description.Id.ProductName ?? ""
                    });
                }

                OutputJson(new
                {
                    success = true,
                    available = true,
                    count = readers.Count,
                    readers = readerList,
                    message = $"Lector biométrico listo ({readerList.Count} dispositivo(s) detectado(s))."
                });
                return 0;
            }
            catch (DllNotFoundException dllEx)
            {
                Console.Error.WriteLine($"[ERROR] DLL faltante al consultar lectores: {dllEx.Message}");
                OutputJson(new
                {
                    success = false,
                    available = false,
                    error = "DLL_NOT_FOUND",
                    message = "Faltan controladores o librerías de DigitalPersona (dpfpdd.dll/dpfj.dll). Instale DigitalPersona RTE."
                });
                return 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[ERROR] Check fallo: {ex}");
                OutputJson(new
                {
                    success = false,
                    available = false,
                    error = "CHECK_FAILED",
                    message = ex.Message
                });
                return 1;
            }
        }

        private static int HandleCapture(int timeoutSeconds)
        {
            Reader reader = null;
            try
            {
                ReaderCollection readers = null;
                try
                {
                    readers = ReaderCollection.GetReaders();
                }
                catch (Exception ex)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "GET_READERS_FAILED",
                        message = $"Error al enumerar lectores: {ex.Message}"
                    });
                    return 1;
                }

                if (readers == null || readers.Count == 0)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "NO_READER",
                        message = "No hay ningún lector DigitalPersona conectado para realizar la captura."
                    });
                    return 1;
                }

                reader = readers[0];

                // 1. Open reader with EXCLUSIVE priority (essential for background/console processes without GUI message pump)
                // Falling back to COOPERATIVE if exclusive is busy.
                Constants.ResultCode openResult = Constants.ResultCode.DP_FAILURE;
                try
                {
                    openResult = reader.Open(Constants.CapturePriority.DP_PRIORITY_EXCLUSIVE);
                }
                catch { }

                if (openResult != Constants.ResultCode.DP_SUCCESS)
                {
                    try
                    {
                        openResult = reader.Open(Constants.CapturePriority.DP_PRIORITY_COOPERATIVE);
                    }
                    catch (Exception openEx)
                    {
                        OutputJson(new
                        {
                            success = false,
                            error = "OPEN_EXCEPTION",
                            message = $"Excepción al abrir el lector: {openEx.Message}"
                        });
                        return 1;
                    }
                }

                if (openResult != Constants.ResultCode.DP_SUCCESS)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "OPEN_FAILED",
                        message = $"No se pudo abrir el lector ({openResult}). Verifique que no esté en uso por otro programa."
                    });
                    return 1;
                }

                // 2. Hardware flush / reset: clears any stale DMA buffers on the U.are.U 4500 microcontroller
                try
                {
                    reader.Reset();
                    Thread.Sleep(30);
                }
                catch { }

                // 3. Detect supported resolution safely to prevent unmanaged buffer overrun
                int resolution = 500;
                try
                {
                    if (reader.Capabilities?.Resolutions != null && reader.Capabilities.Resolutions.Length > 0)
                    {
                        resolution = reader.Capabilities.Resolutions[0];
                    }
                }
                catch { }

                int timeoutMs = timeoutSeconds * 1000;
                Console.Error.WriteLine($"[INFO] Esperando huella en lector '{reader.Description?.Name ?? "U.are.U 4500"}' (resolución: {resolution}dpi, límite: {timeoutSeconds}s)...");

                // 4. Capture raw image (FID) with ANSI format
                CaptureResult captureResult = null;
                try
                {
                    captureResult = reader.Capture(
                        Constants.Formats.Fid.ANSI,
                        Constants.CaptureProcessing.DP_IMG_PROC_DEFAULT,
                        timeoutMs,
                        resolution
                    );
                }
                catch (AccessViolationException ave)
                {
                    Console.Error.WriteLine($"[WARN] AccessViolation capturado en hardware: {ave.Message}");
                    OutputJson(new
                    {
                        success = false,
                        error = "HARDWARE_ACCESS_VIOLATION",
                        message = "El lector físico experimentó un reinicio de buffer de memoria. Intente colocar el dedo nuevamente."
                    });
                    return 1;
                }
                catch (Exception capEx)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "CAPTURE_CALL_FAILED",
                        message = capEx.Message
                    });
                    return 1;
                }

                if (captureResult == null)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "NULL_RESULT",
                        message = "La operación de captura no retornó datos del controlador."
                    });
                    return 1;
                }

                if (captureResult.ResultCode != Constants.ResultCode.DP_SUCCESS)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "CAPTURE_ERROR",
                        message = $"Error durante la captura del lector: {captureResult.ResultCode}"
                    });
                    return 1;
                }

                if (captureResult.Quality == Constants.CaptureQuality.DP_QUALITY_TIMED_OUT || captureResult.Data == null)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "TIMED_OUT",
                        message = "Tiempo de espera agotado. No se colocó ningún dedo sobre el sensor."
                    });
                    return 1;
                }

                if (captureResult.Quality == Constants.CaptureQuality.DP_QUALITY_CANCELED)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "CANCELED",
                        message = "Captura cancelada."
                    });
                    return 1;
                }

                if (captureResult.Quality != Constants.CaptureQuality.DP_QUALITY_GOOD)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "POOR_QUALITY",
                        quality = captureResult.Quality.ToString(),
                        message = "Calidad de huella insuficiente. Coloque el dedo firmemente centrado sobre el cristal."
                    });
                    return 1;
                }

                // 5. Extract Minutiae Data (FMD) from captured FID using standard ANSI INCITS 378-2004 format
                DataResult<Fmd> fmdResult = null;
                try
                {
                    fmdResult = FeatureExtraction.CreateFmdFromFid(captureResult.Data, Constants.Formats.Fmd.ANSI);
                }
                catch (Exception fmdEx)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "FEATURE_EXTRACTION_ERROR",
                        message = $"Error extrayendo minucias: {fmdEx.Message}"
                    });
                    return 1;
                }

                if (fmdResult == null || fmdResult.ResultCode != Constants.ResultCode.DP_SUCCESS || fmdResult.Data == null)
                {
                    OutputJson(new
                    {
                        success = false,
                        error = "EXTRACTION_FAILED",
                        message = $"No se pudieron extraer minucias biométricas de la imagen capturada ({fmdResult?.ResultCode})."
                    });
                    return 1;
                }

                // 6. Serialize Fmd to XML and encode in Base64 (maintaining complete compatibility with KaliAccess database)
                string xml = Fmd.SerializeXml(fmdResult.Data);
                string base64Template = Convert.ToBase64String(Encoding.UTF8.GetBytes(xml));

                OutputJson(new
                {
                    success = true,
                    template = base64Template,
                    format = "ANSI_378_2004",
                    quality = captureResult.Quality.ToString(),
                    message = "Huella capturada y procesada exitosamente."
                });
                return 0;
            }
            catch (AccessViolationException ave)
            {
                Console.Error.WriteLine($"[FATAL_AV] AccessViolationException prevenido en HandleCapture: {ave}");
                OutputJson(new
                {
                    success = false,
                    error = "ACCESS_VIOLATION_HANDLED",
                    message = "Interrupción de memoria de hardware prevenida. El lector se reintentará automáticamente."
                });
                return 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[ERROR] Excepción en captura: {ex}");
                OutputJson(new
                {
                    success = false,
                    error = "CAPTURE_EXCEPTION",
                    message = ex.Message
                });
                return 1;
            }
            finally
            {
                // Safe teardown sequence: cancel active transfer -> dispose object
                if (reader != null)
                {
                    try { reader.CancelCapture(); } catch { }
                    try { reader.Dispose(); } catch { }
                }
            }
        }

        private static int HandleIdentify(string[] args)
        {
            IdentifyRequestDto req = null;
            string inputJson = null;

            // Check if input file passed
            for (int i = 1; i < args.Length; i++)
            {
                if (args[i] == "--input-file" && i + 1 < args.Length && File.Exists(args[i + 1]))
                {
                    inputJson = File.ReadAllText(args[i + 1], Encoding.UTF8);
                    break;
                }
            }

            if (string.IsNullOrWhiteSpace(inputJson))
            {
                // Read from stdin
                using (var reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8))
                {
                    inputJson = reader.ReadToEnd();
                }
            }

            if (string.IsNullOrWhiteSpace(inputJson))
            {
                OutputJson(new
                {
                    success = false,
                    error = "NO_INPUT_DATA",
                    message = "Se requiere el JSON con la huella capturada y la lista de candidatos."
                });
                return 1;
            }

            try
            {
                req = JsonSerializer.Deserialize<IdentifyRequestDto>(inputJson);
            }
            catch (Exception ex)
            {
                OutputJson(new
                {
                    success = false,
                    error = "INVALID_JSON",
                    message = $"Formato JSON inválido: {ex.Message}"
                });
                return 1;
            }

            if (string.IsNullOrWhiteSpace(req?.Sample))
            {
                OutputJson(new
                {
                    success = false,
                    error = "MISSING_SAMPLE",
                    message = "La huella capturada (sample) es requerida."
                });
                return 1;
            }

            if (req.Candidates == null || req.Candidates.Count == 0)
            {
                OutputJson(new
                {
                    success = true,
                    matched = false,
                    message = "No hay candidatos biométricos registrados para comparar."
                });
                return 0;
            }

            int threshold = req.Threshold.GetValueOrDefault(DEFAULT_THRESHOLD);

            Fmd sampleFmd = null;
            try
            {
                string sampleXml = DecodeTemplateXml(req.Sample);
                sampleFmd = Fmd.DeserializeXml(sampleXml);
            }
            catch (Exception ex)
            {
                OutputJson(new
                {
                    success = false,
                    error = "INVALID_SAMPLE_TEMPLATE",
                    message = $"La plantilla capturada no es válida: {ex.Message}"
                });
                return 1;
            }

            int bestScore = int.MaxValue;
            CandidateDto bestCandidate = null;
            int candidatesEvaluated = 0;

            foreach (var cand in req.Candidates)
            {
                if (string.IsNullOrWhiteSpace(cand?.Template)) continue;

                try
                {
                    string candXml = DecodeTemplateXml(cand.Template);
                    Fmd candFmd = Fmd.DeserializeXml(candXml);

                    CompareResult compResult = Comparison.Compare(sampleFmd, 0, candFmd, 0);
                    candidatesEvaluated++;

                    if (compResult.ResultCode == Constants.ResultCode.DP_SUCCESS)
                    {
                        // In DigitalPersona SDK, score represents dissimilarity (0 is identical, higher is more distant).
                        // Match occurs when score <= threshold.
                        if (compResult.Score <= threshold && compResult.Score < bestScore)
                        {
                            bestScore = compResult.Score;
                            bestCandidate = cand;
                        }
                    }
                }
                catch
                {
                    // Ignore corrupted individual candidate template without failing whole comparison
                }
            }

            if (bestCandidate != null)
            {
                OutputJson(new
                {
                    success = true,
                    matched = true,
                    clientId = bestCandidate.Id,
                    clientName = bestCandidate.Name,
                    score = bestScore,
                    threshold = threshold,
                    farDissimilarity = bestScore,
                    candidatesEvaluated = candidatesEvaluated,
                    message = $"Socio identificado: {bestCandidate.Name}"
                });
                return 0;
            }

            OutputJson(new
            {
                success = true,
                matched = false,
                threshold = threshold,
                candidatesEvaluated = candidatesEvaluated,
                message = "Huella no reconocida en la base de datos de socios."
            });
            return 0;
        }

        private static int HandleVerify(string[] args)
        {
            string inputJson = null;
            using (var reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8))
            {
                inputJson = reader.ReadToEnd();
            }

            if (string.IsNullOrWhiteSpace(inputJson))
            {
                OutputJson(new { success = false, error = "NO_INPUT_DATA" });
                return 1;
            }

            VerifyRequestDto req = JsonSerializer.Deserialize<VerifyRequestDto>(inputJson);
            if (string.IsNullOrWhiteSpace(req?.Sample) || string.IsNullOrWhiteSpace(req?.Target))
            {
                OutputJson(new { success = false, error = "MISSING_FIELDS", message = "Se requieren sample y target." });
                return 1;
            }

            int threshold = req.Threshold.GetValueOrDefault(DEFAULT_THRESHOLD);

            try
            {
                string sampleXml = DecodeTemplateXml(req.Sample);
                string targetXml = DecodeTemplateXml(req.Target);

                Fmd sampleFmd = Fmd.DeserializeXml(sampleXml);
                Fmd targetFmd = Fmd.DeserializeXml(targetXml);

                CompareResult cr = Comparison.Compare(sampleFmd, 0, targetFmd, 0);

                bool matched = cr.ResultCode == Constants.ResultCode.DP_SUCCESS && cr.Score <= threshold;

                OutputJson(new
                {
                    success = true,
                    matched = matched,
                    score = cr.Score,
                    threshold = threshold,
                    resultCode = cr.ResultCode.ToString()
                });
                return 0;
            }
            catch (Exception ex)
            {
                OutputJson(new
                {
                    success = false,
                    error = "VERIFY_EXCEPTION",
                    message = ex.Message
                });
                return 1;
            }
        }

        private static string DecodeTemplateXml(string template)
        {
            if (string.IsNullOrWhiteSpace(template)) return "";
            string trimmed = template.Trim();
            if (trimmed.StartsWith("<"))
            {
                return trimmed;
            }
            try
            {
                byte[] bytes = Convert.FromBase64String(trimmed);
                return Encoding.UTF8.GetString(bytes);
            }
            catch
            {
                return trimmed;
            }
        }

        private static void OutputJson(object data)
        {
            var options = new JsonSerializerOptions
            {
                WriteIndented = false,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            };
            string json = JsonSerializer.Serialize(data, options);
            Console.WriteLine(json);
        }
    }
}
