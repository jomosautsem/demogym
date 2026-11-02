import React, { useState, useEffect } from 'react';
import { Product, CartItem, PaymentMethod, Client, SystemConfig } from '../types';
import { 
  getProducts, 
  searchClientsInternal, 
  processProductSale, 
  recordClientDirectPayment,
  getSystemConfig,
  DEFAULT_WA_PAYMENT_TEMPLATE
} from '../services/storage';
import { useToast } from '../context/ToastContext';
import PaymentHistoryModal from './PaymentHistoryModal';
import jsPDF from 'jspdf';

interface PointOfSaleProps {
  userName: string;
  onPaymentSuccess?: () => void;
}

interface VoucherData {
  folio: string;
  clientName: string;
  clientPhone?: string;
  amount: number;
  concept: string;
  method: PaymentMethod;
  created_by: string;
  date: string;
  notes?: string;
}

const PRESET_AMOUNTS = [50, 100, 150, 200, 300, 500, 1000];

const PRESET_CONCEPTS = [
  'Abono a Membresía',
  'Visita / Pase Diario',
  'Inscripción / Matrícula',
  'Locker / Casillero',
  'Clase Extra / Taller',
  'Entrenamiento Personal',
  'Penalización / Recargo',
  'Cuota de Recuperación'
];

const PointOfSale: React.FC<PointOfSaleProps> = ({ userName, onPaymentSuccess }) => {
  const { showToast } = useToast();
  
  // Navigation Mode
  const [activeMode, setActiveMode] = useState<'PRODUCTS' | 'DIRECT_PAYMENT'>('PRODUCTS');

  // Products State
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Client Assignment State (Shared across both modes)
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [foundClients, setFoundClients] = useState<Client[]>([]);
  const [isSearchingClients, setIsSearchingClients] = useState(false);

  // Direct Payment Form State (Option B)
  const [directAmount, setDirectAmount] = useState('');
  const [directConcept, setDirectConcept] = useState('Abono a Membresía');
  const [directNotes, setDirectNotes] = useState('');
  const [directMethod, setDirectMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [isSubmittingDirect, setIsSubmittingDirect] = useState(false);

  // Custom Item Modal for Cart
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState('');

  // Cart Checkout State
  const [cartPaymentMethod, setCartPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [isProcessingCart, setIsProcessingCart] = useState(false);

  // Modals
  const [voucherData, setVoucherData] = useState<VoucherData | null>(null);
  const [viewHistoryClient, setViewHistoryClient] = useState<Client | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);

  useEffect(() => {
    loadProducts();
    getSystemConfig().then(cfg => setSystemConfig(cfg)).catch(() => {});
  }, []);

  const loadProducts = async () => {
    try {
      const data = await getProducts();
      setProducts(data.filter(p => p.is_active));
    } catch (err) {
      console.error("Error loading products:", err);
    }
  };

  // Live client search
  const handleClientSearchChange = async (val: string) => {
    setClientSearch(val);
    if (!val.trim()) {
      setFoundClients([]);
      return;
    }
    setIsSearchingClients(true);
    try {
      const results = await searchClientsInternal(val);
      setFoundClients(results);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSearchingClients(false);
    }
  };

  const handleSelectClient = (c: Client) => {
    setSelectedClient(c);
    setFoundClients([]);
    setClientSearch('');
  };

  // --- CART MANAGEMENT ---
  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      showToast('Producto sin stock', 'warning');
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          showToast('No hay suficiente stock', 'warning');
          return prev;
        }
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => {
      return prev.map(item => {
        if (item.id === productId) {
          const newQty = item.quantity + delta;
          if (newQty < 1) return item;
          if (item.stock > 0 && newQty > item.stock) {
            showToast('Stock insuficiente', 'warning');
            return item;
          }
          return { ...item, quantity: newQty };
        }
        return item;
      });
    });
  };

  const handleAddCustomCartItem = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(customItemPrice);
    if (!customItemName.trim() || isNaN(price) || price <= 0) {
      showToast('Ingresa un concepto y monto válido', 'warning');
      return;
    }

    const customProduct: CartItem = {
      id: `custom-item-${Date.now()}`,
      name: customItemName.trim().toUpperCase(),
      category: 'OTROS',
      price_buy: 0,
      price_sell: price,
      stock: 9999,
      is_active: true,
      quantity: 1
    };

    setCart(prev => [...prev, customProduct]);
    setCustomItemName('');
    setCustomItemPrice('');
    setShowCustomItemModal(false);
    showToast('Concepto agregado al carrito', 'success');
  };

  const handleCartCheckout = async () => {
    if (cart.length === 0 || isProcessingCart) return;

    setIsProcessingCart(true);
    try {
      const totalAmount = cart.reduce((acc, item) => acc + (item.price_sell * item.quantity), 0);
      const description = `VENTA TIENDA: ${cart.map(i => `${i.quantity}x ${i.name}`).join(', ')}`;
      const folio = `TK-${Date.now().toString(36).toUpperCase()}`;
      const nowStr = new Date().toLocaleString('es-MX', { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit' 
      });

      await processProductSale(
        cart,
        cartPaymentMethod,
        selectedClient ? selectedClient.id : null,
        userName
      );

      const voucher: VoucherData = {
        folio,
        clientName: selectedClient 
          ? `${selectedClient.firstName} ${selectedClient.lastNamePaternal} ${selectedClient.lastNameMaternal || ''}`.trim()
          : 'PÚBLICO GENERAL / MOSTRADOR',
        clientPhone: selectedClient?.phone || undefined,
        amount: totalAmount,
        concept: description,
        method: cartPaymentMethod,
        created_by: userName,
        date: nowStr
      };

      setVoucherData(voucher);
      showToast('VENTA REGISTRADA CON ÉXITO', 'success');
      setCart([]);
      loadProducts();
      onPaymentSuccess?.();
    } catch (e: any) {
      showToast('Error en venta: ' + (e.message || 'Desconocido'), 'error');
    } finally {
      setIsProcessingCart(false);
    }
  };

  // --- OPTION B: DIRECT PAYMENT REGISTRATION (NO RENEWAL) ---
  const handleRegisterDirectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) {
      showToast('Debes seleccionar un socio para registrar el pago', 'warning');
      return;
    }

    const amountNum = parseFloat(directAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Ingresa un monto válido mayor a $0', 'warning');
      return;
    }

    if (!directConcept.trim()) {
      showToast('Especifica el concepto del cobro', 'warning');
      return;
    }

    setIsSubmittingDirect(true);
    try {
      const clientFullName = `${selectedClient.firstName} ${selectedClient.lastNamePaternal} ${selectedClient.lastNameMaternal || ''}`.trim();
      let fullConcept = `PAGO SOCIO: ${directConcept.trim().toUpperCase()}`;
      if (directNotes.trim()) {
        fullConcept += ` (${directNotes.trim()})`;
      }

      const folio = `PAG-${Date.now().toString(36).toUpperCase()}`;
      const nowStr = new Date().toLocaleString('es-MX', { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit' 
      });

      // Insert directly into payments table (never affects membership dates)
      await recordClientDirectPayment(
        selectedClient.id,
        amountNum,
        directMethod,
        fullConcept,
        userName
      );

      const voucher: VoucherData = {
        folio,
        clientName: clientFullName,
        clientPhone: selectedClient.phone || undefined,
        amount: amountNum,
        concept: fullConcept,
        method: directMethod,
        created_by: userName,
        date: nowStr,
        notes: directNotes.trim() || undefined
      };

      setVoucherData(voucher);
      showToast(`PAGO REGISTRADO DE $${amountNum.toFixed(2)} A ${clientFullName}`, 'success');
      
      // Reset form fields
      setDirectAmount('');
      setDirectNotes('');
      setDirectConcept('Abono a Membresía');

      // Refresh any metrics
      onPaymentSuccess?.();
    } catch (err: any) {
      console.error("Error registering direct payment:", err);
      showToast('Error al registrar el pago: ' + (err.message || 'Error en servidor'), 'error');
    } finally {
      setIsSubmittingDirect(false);
    }
  };

  // --- VOUCHER ACTIONS ---
  const handleSendWhatsAppVoucher = (voucher: VoucherData) => {
    if (!voucher.clientPhone) {
      showToast('El socio no tiene teléfono registrado', 'warning');
      return;
    }
    const cleanPhone = voucher.clientPhone.replace(/\D/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `521${cleanPhone}` : cleanPhone;
    
    // Extraer únicamente el primer nombre del coach / personal que atendió (sin apellidos)
    const rawCoach = (voucher.created_by || '').trim();
    const coachFirstName = rawCoach ? rawCoach.split(/\s+/)[0] : 'Recepción';

    // Obtener plantilla activa (personalizada en el editor o predeterminada)
    const template = systemConfig?.wa_template_payment || DEFAULT_WA_PAYMENT_TEMPLATE;

    const msg = template
      .replace(/\{NOMBRE\}/gi, voucher.clientName)
      .replace(/\{COACH\}/gi, coachFirstName)
      .replace(/\{COACH_NOMBRE\}/gi, coachFirstName)
      .replace(/\{FOLIO\}/gi, voucher.folio)
      .replace(/\{FECHA\}/gi, voucher.date)
      .replace(/\{MONTO\}/gi, voucher.amount.toFixed(2))
      .replace(/\{CONCEPTO\}/gi, voucher.concept)
      .replace(/\{METODO\}/gi, voucher.method);

    const url = `https://api.whatsapp.com/send?phone=${phoneWithCountry}&text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const handlePrintReceiptPdf = (voucher: VoucherData) => {
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, 150] // Formato ticket térmico 80mm
      });

      const rawCoach = (voucher.created_by || '').trim();
      const coachFirstName = rawCoach ? rawCoach.split(/\s+/)[0] : 'Recepción';

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('KALI ACCESS', 40, 12, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('COMPROBANTE DE PAGO EN CAJA', 40, 17, { align: 'center' });
      doc.text('------------------------------------------------', 40, 21, { align: 'center' });

      doc.setFontSize(7.5);
      doc.text(`FOLIO: ${voucher.folio}`, 8, 27);
      doc.text(`FECHA: ${voucher.date}`, 8, 32);
      doc.text(`ATENDIÓ: ${coachFirstName}`, 8, 37);
      doc.text('------------------------------------------------', 40, 41, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.text(`SOCIO: ${voucher.clientName}`, 8, 47);
      doc.setFont('helvetica', 'normal');
      doc.text(`TELÉFONO: ${voucher.clientPhone || 'No registrado'}`, 8, 52);
      doc.text('------------------------------------------------', 40, 56, { align: 'center' });

      doc.text('CONCEPTO DE PAGO:', 8, 62);
      doc.setFont('helvetica', 'bold');
      const splitConcept = doc.splitTextToSize(voucher.concept, 64);
      doc.text(splitConcept, 8, 67);

      const conceptY = 67 + (splitConcept.length * 4);
      doc.setFont('helvetica', 'normal');
      doc.text(`MÉTODO DE PAGO: ${voucher.method}`, 8, conceptY + 5);
      doc.text('------------------------------------------------', 40, conceptY + 9, { align: 'center' });

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`TOTAL: $${voucher.amount.toFixed(2)} MXN`, 40, conceptY + 17, { align: 'center' });

      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'italic');
      doc.text('Registro en corte de caja // Membresía no alterada', 40, conceptY + 24, { align: 'center' });
      doc.text('¡Gracias por tu pago y preferencia!', 40, conceptY + 28, { align: 'center' });

      doc.save(`Recibo_${voucher.folio}.pdf`);
      showToast('RECIBO PDF GENERADO', 'success');
    } catch (e) {
      console.error(e);
      showToast('Error al exportar recibo PDF', 'error');
    }
  };

  const totalCart = cart.reduce((acc, item) => acc + (item.price_sell * item.quantity), 0);
  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="h-full flex flex-col gap-4 animate-[fadeIn_0.3s_ease-out] relative">
      {/* TOP HEADER CONTROLS */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-zinc-950 p-3 border border-zinc-800 shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(234,179,8,0.8)]"></div>
          <div>
            <h2 className="text-xl font-tech font-black text-white tracking-wider">
              PUNTO DE VENTA <span className="text-yellow-500">// CAJA</span>
            </h2>
            <p className="text-[10px] text-zinc-500 font-mono-tech">
              OPERADOR: <span className="text-yellow-400 font-bold">{userName.toUpperCase()}</span>
            </p>
          </div>
        </div>

        {/* MODE TOGGLE TABS */}
        <div className="flex bg-black p-1 border border-zinc-800 rounded">
          <button
            onClick={() => setActiveMode('PRODUCTS')}
            className={`flex-1 sm:flex-none px-4 py-2 text-xs font-tech font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
              activeMode === 'PRODUCTS'
                ? 'bg-yellow-500 text-black shadow-lg font-black'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            PRODUCTOS (TIENDA)
          </button>
          
          <button
            onClick={() => setActiveMode('DIRECT_PAYMENT')}
            className={`flex-1 sm:flex-none px-4 py-2 text-xs font-tech font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
              activeMode === 'DIRECT_PAYMENT'
                ? 'bg-emerald-500 text-black shadow-lg font-black'
                : 'text-zinc-400 hover:text-emerald-400'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            PAGO A SOCIO (SIN RENOVAR)
          </button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
        
        {/* ========================================================================= */}
        {/* MODE 1: DIRECT PAYMENT TO CLIENT (OPTION B)                               */}
        {/* ========================================================================= */}
        {activeMode === 'DIRECT_PAYMENT' ? (
          <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-y-auto custom-scrollbar p-1">
            
            {/* LEFT / TOP: SOCIO SELECTION & DETAILS */}
            <div className="flex-1 flex flex-col gap-4">
              
              {/* Socio Search & Selector */}
              <div className="relative z-30 bg-zinc-950 border border-zinc-800 p-5 shadow-xl">
                <div className="flex items-center justify-between mb-3 border-b border-zinc-800 pb-2">
                  <h3 className="text-sm font-tech font-bold text-yellow-500 uppercase tracking-widest flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    PASO 1: SELECCIONAR SOCIO
                  </h3>
                  {selectedClient && (
                    <button
                      onClick={() => setSelectedClient(null)}
                      className="text-xs text-red-400 hover:text-red-300 font-tech font-bold uppercase transition-colors"
                    >
                      [✕ CAMBIAR SOCIO]
                    </button>
                  )}
                </div>

                {!selectedClient ? (
                  <div className="relative z-40">
                    <div className="relative">
                      <input
                        type="text"
                        value={clientSearch}
                        onChange={(e) => handleClientSearchChange(e.target.value)}
                        placeholder="BUSCAR SOCIO POR NOMBRE, APELLIDO O TELÉFONO..."
                        className="w-full bg-zinc-900 border-2 border-zinc-700 p-3.5 pl-11 text-white font-mono-tech text-sm outline-none focus:border-yellow-500 transition-all placeholder:text-zinc-600"
                        autoFocus
                      />
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>

                    {/* Autocomplete Dropdown */}
                    {foundClients.length > 0 && (
                      <div 
                        style={{ backgroundColor: '#18181b', opacity: 1 }}
                        className="absolute top-full left-0 right-0 mt-1.5 bg-[#18181b] border-2 border-yellow-500/70 max-h-72 overflow-y-auto z-[100] shadow-[0_25px_50px_rgba(0,0,0,0.95)] divide-y divide-zinc-800 rounded-b"
                      >
                        <div 
                          style={{ backgroundColor: '#121214' }}
                          className="sticky top-0 z-10 bg-[#121214] px-3 py-1.5 border-b border-zinc-800 flex justify-between items-center text-[10px] font-mono-tech text-yellow-500 uppercase"
                        >
                          <span>Socios encontrados ({foundClients.length})</span>
                          <button 
                            type="button" 
                            onClick={() => setFoundClients([])} 
                            className="text-zinc-400 hover:text-white uppercase font-bold text-[10px] transition-colors"
                          >
                            Cerrar [✕]
                          </button>
                        </div>
                        {foundClients.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleSelectClient(c)}
                            className="w-full text-left p-3 bg-[#18181b] hover:!bg-yellow-500 hover:text-black flex items-center justify-between group transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                                {c.photoUrl ? (
                                  <img src={c.photoUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="font-bold text-xs text-zinc-400 group-hover:text-black">
                                    {c.firstName.charAt(0)}{c.lastNamePaternal.charAt(0)}
                                  </span>
                                )}
                              </div>
                              <div>
                                <p className="font-bold text-sm text-white group-hover:text-black uppercase">
                                  {c.firstName} {c.lastNamePaternal} {c.lastNameMaternal || ''}
                                </p>
                                <p className="text-xs text-zinc-400 group-hover:text-zinc-800 font-mono-tech">
                                  {c.phone || 'Sin Teléfono'} • {c.packageName || c.activityName || 'Sin Plan'}
                                </p>
                              </div>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 border ${
                              c.isActive 
                                ? 'border-emerald-600 text-emerald-400 group-hover:border-black group-hover:text-black bg-emerald-950/30' 
                                : 'border-zinc-700 text-zinc-500 group-hover:border-black group-hover:text-black'
                            }`}>
                              {c.isActive ? 'ACTIVO' : 'DE BAJA'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {isSearchingClients && (
                      <p className="text-xs text-yellow-500 font-mono-tech mt-2 animate-pulse">Buscando socios...</p>
                    )}
                  </div>
                ) : (
                  /* Assigned Client Highlight Card */
                  <div className="bg-gradient-to-r from-zinc-900 to-zinc-900/60 border border-emerald-500/40 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded bg-black border-2 border-emerald-500 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-lg">
                        {selectedClient.photoUrl ? (
                          <img src={selectedClient.photoUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-lg font-black text-emerald-400">
                            {selectedClient.firstName.charAt(0)}{selectedClient.lastNamePaternal.charAt(0)}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-500 text-black uppercase">
                            SOCIO ASIGNADO
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 border ${
                            selectedClient.isActive ? 'border-emerald-500 text-emerald-400' : 'border-red-500 text-red-400'
                          }`}>
                            {selectedClient.isActive ? 'MEMBRESÍA ACTIVA' : 'DE BAJA'}
                          </span>
                        </div>
                        <h4 className="text-lg font-bold text-white uppercase mt-1">
                          {selectedClient.firstName} {selectedClient.lastNamePaternal} {selectedClient.lastNameMaternal || ''}
                        </h4>
                        <p className="text-xs text-zinc-400 font-mono-tech">
                          TEL: {selectedClient.phone || 'N/A'} • PLAN: {selectedClient.packageName || selectedClient.activityName || 'Sin Plan Asignado'}
                        </p>
                      </div>
                    </div>

                    <div className="flex sm:flex-col gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setViewHistoryClient(selectedClient)}
                        className="flex-1 sm:flex-none bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 px-3 py-1.5 text-xs font-tech font-bold uppercase transition-all flex items-center justify-center gap-1.5"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        VER HISTORIAL DE PAGOS
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Security & Operational Transparency Notice */}
              <div className="bg-blue-950/20 border border-blue-500/30 p-4 flex items-start gap-3">
                <div className="p-2 bg-blue-500/20 border border-blue-400/40 text-blue-400 rounded">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-tech font-bold text-blue-400 uppercase tracking-wider mb-1">
                    MODO COBRO DIRECTO // SIN RENOVACIÓN FORZADA
                  </h4>
                  <p className="text-xs text-zinc-300 font-mono-tech leading-relaxed">
                    Este formulario permite registrar abonos, visitas o cuotas extraordinarias que entran directamente a la caja y al historial del socio. 
                    <strong className="text-white"> No modifica ni altera las fechas de vigencia ni estatus de membresía</strong>, garantizando que el Administrador tenga el registro contable exacto sin descuadres en turnos.
                  </p>
                </div>
              </div>
            </div>

            {/* RIGHT: PAYMENT FORM */}
            <div className="w-full lg:w-[460px] bg-zinc-950 border border-zinc-800 p-6 flex flex-col shadow-2xl">
              <h3 className="text-sm font-tech font-bold text-yellow-500 uppercase tracking-widest border-b border-zinc-800 pb-3 mb-5 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 12v4m0 4v.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                PASO 2: DATOS DEL COBRO
              </h3>

              <form onSubmit={handleRegisterDirectPayment} className="space-y-5 flex-1 flex flex-col justify-between">
                <div className="space-y-5">
                  {/* Amount Input */}
                  <div>
                    <label className="block text-xs font-tech text-yellow-500/80 mb-1.5 uppercase tracking-wider">
                      MONTO A COBRAR (MXN) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 font-black text-2xl">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        value={directAmount}
                        onChange={(e) => setDirectAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-black border-2 border-zinc-700 pl-10 pr-4 py-3 text-2xl font-mono-tech font-bold text-emerald-400 outline-none focus:border-yellow-500 transition-all placeholder:text-zinc-700"
                        required
                      />
                    </div>

                    {/* Quick Amount Buttons */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {PRESET_AMOUNTS.map(amt => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setDirectAmount(amt.toString())}
                          className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-yellow-500 text-zinc-300 hover:text-white px-2.5 py-1 text-xs font-mono-tech font-bold transition-all"
                        >
                          ${amt}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setDirectAmount('')}
                        className="bg-zinc-900/50 hover:bg-red-950 text-zinc-500 hover:text-red-400 border border-zinc-800 px-2 py-1 text-xs font-mono-tech transition-all"
                      >
                        Limpiar
                      </button>
                    </div>
                  </div>

                  {/* Concept Input & Presets */}
                  <div>
                    <label className="block text-xs font-tech text-yellow-500/80 mb-1.5 uppercase tracking-wider">
                      CONCEPTO DEL COBRO *
                    </label>
                    <input
                      type="text"
                      value={directConcept}
                      onChange={(e) => setDirectConcept(e.target.value)}
                      placeholder="Ej. Abono a cuenta de socio"
                      className="w-full bg-black border border-zinc-700 p-2.5 text-white font-mono-tech text-sm outline-none focus:border-yellow-500"
                      required
                    />

                    {/* Preset Chips */}
                    <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-y-auto custom-scrollbar p-0.5">
                      {PRESET_CONCEPTS.map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setDirectConcept(preset)}
                          className={`text-[11px] px-2 py-1 font-tech uppercase tracking-wide border transition-all ${
                            directConcept === preset
                              ? 'bg-yellow-500 text-black border-yellow-500 font-bold'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-white'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div>
                    <label className="block text-xs font-tech text-yellow-500/80 mb-1.5 uppercase tracking-wider">
                      MÉTODO DE PAGO *
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER].map(method => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setDirectMethod(method)}
                          className={`py-2.5 text-xs font-tech font-bold uppercase border transition-all flex flex-col items-center justify-center gap-1 ${
                            directMethod === method
                              ? 'bg-white text-black border-white shadow-lg'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600'
                          }`}
                        >
                          <span>{method === PaymentMethod.CASH ? '💵' : method === PaymentMethod.CARD ? '💳' : '📲'}</span>
                          <span>{method}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes / Reference (Optional) */}
                  <div>
                    <label className="block text-xs font-tech text-zinc-500 mb-1.5 uppercase tracking-wider">
                      OBSERVACIONES / REFERENCIA (OPCIONAL)
                    </label>
                    <input
                      type="text"
                      value={directNotes}
                      onChange={(e) => setDirectNotes(e.target.value)}
                      placeholder="Ej. Folio transf. 4819, abono 1 de 2..."
                      className="w-full bg-black border border-zinc-800 p-2.5 text-white font-mono-tech text-xs outline-none focus:border-zinc-600"
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <div className="pt-4 border-t border-zinc-900 mt-6">
                  <button
                    type="submit"
                    disabled={isSubmittingDirect || !selectedClient || !directAmount || parseFloat(directAmount) <= 0}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-tech font-bold uppercase py-4 text-base shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:opacity-40 disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {isSubmittingDirect ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                        <span>REGISTRANDO PAGO...</span>
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>REGISTRAR PAGO :: ${parseFloat(directAmount || '0').toFixed(2)}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* MODE 2: REGULAR PRODUCT CATALOG & CART                                    */
          /* ========================================================================= */
          <>
            {/* LEFT: PRODUCTS GRID */}
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="mb-4 flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="BUSCAR PRODUCTO POR NOMBRE..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 p-3.5 pl-10 text-white font-mono-tech outline-none focus:border-yellow-500"
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>

                <button
                  onClick={() => setShowCustomItemModal(true)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-yellow-500 border border-zinc-700 px-4 py-2 font-tech font-bold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5"
                  title="Cobrar concepto manual en este carrito"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>+ COBRO MANUAL</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-1 custom-scrollbar">
                {filteredProducts.map(product => (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    disabled={product.stock <= 0}
                    className={`bg-zinc-900 border border-zinc-800 p-4 flex flex-col items-center justify-between transition-all hover:border-yellow-500 group relative ${
                      product.stock <= 0 ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {product.stock <= 0 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/70 font-bold text-red-500 font-tech">
                        AGOTADO
                      </div>
                    )}
                    <div className="w-20 h-20 bg-black mb-3 overflow-hidden flex items-center justify-center border border-zinc-800">
                      {product.image_url ? (
                        <img src={product.image_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-zinc-700 text-xs">NO IMG</span>
                      )}
                    </div>
                    <div className="text-center w-full">
                      <p className="text-white font-bold text-sm truncate w-full group-hover:text-yellow-500">
                        {product.name}
                      </p>
                      <p className="text-zinc-500 text-xs mt-1">{product.category}</p>
                      <div className="flex justify-between items-center mt-2 border-t border-zinc-800 pt-2 w-full">
                        <span className="text-emerald-400 font-mono-tech font-bold">${product.price_sell}</span>
                        <span className="text-zinc-600 text-[10px]">Stock: {product.stock}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* RIGHT: CART & CHECKOUT */}
            <div className="w-full md:w-96 bg-zinc-950 border-l border-zinc-800 flex flex-col h-full shadow-2xl">
              <div className="p-4 bg-yellow-500 text-black font-tech font-bold text-lg flex justify-between items-center">
                <span>CARRITO DE COMPRA</span>
                <span>{cart.length} ITEMS</span>
              </div>

              {/* Client Assignment Section */}
              <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
                {selectedClient ? (
                  <div className="bg-emerald-900/20 border border-emerald-500/30 p-2.5 rounded">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">SOCIO ASIGNADO</p>
                        <p className="text-white text-sm font-bold uppercase">
                          {selectedClient.firstName} {selectedClient.lastNamePaternal}
                        </p>
                        <p className="text-zinc-400 text-xs font-mono-tech">
                          {selectedClient.phone || 'Sin Teléfono'}
                        </p>
                      </div>
                      <button onClick={() => setSelectedClient(null)} className="text-zinc-500 hover:text-white p-1">
                        ✕
                      </button>
                    </div>

                    <div className="mt-2 pt-2 border-t border-emerald-500/20 flex gap-2">
                      <button
                        onClick={() => setActiveMode('DIRECT_PAYMENT')}
                        className="flex-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-[10px] font-tech font-bold py-1 uppercase transition-colors"
                      >
                        💰 COBRAR ABONO
                      </button>
                      <button
                        onClick={() => setViewHistoryClient(selectedClient)}
                        className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-600 text-[10px] font-tech font-bold py-1 uppercase transition-colors"
                      >
                        📋 HISTORIAL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative z-30">
                    <div className="flex gap-2">
                      <input
                        value={clientSearch}
                        onChange={(e) => handleClientSearchChange(e.target.value)}
                        placeholder="ASIGNAR A SOCIO (OPCIONAL)"
                        className="flex-1 bg-black border border-zinc-700 p-2 text-xs text-white outline-none focus:border-yellow-500"
                      />
                    </div>
                    {foundClients.length > 0 && (
                      <div 
                        style={{ backgroundColor: '#18181b', opacity: 1 }}
                        className="absolute top-full left-0 right-0 mt-1 bg-[#18181b] border-2 border-zinc-700 max-h-48 overflow-y-auto z-[100] shadow-[0_20px_40px_rgba(0,0,0,0.95)] divide-y divide-zinc-800 rounded-b"
                      >
                        {foundClients.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleSelectClient(c)}
                            className="w-full text-left p-2.5 text-xs text-zinc-300 bg-[#18181b] hover:!bg-yellow-500 hover:text-black transition-colors flex justify-between items-center cursor-pointer"
                          >
                            <span className="font-bold uppercase">{c.firstName} {c.lastNamePaternal}</span>
                            <span className="text-[10px] opacity-75">{c.phone || ''}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Cart Items */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-600 font-mono-tech text-xs gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span>CARRITO VACÍO</span>
                  </div>
                ) : (
                  cart.map(item => (
                    <div key={item.id} className="bg-zinc-900 border border-zinc-800 p-2.5 flex gap-3 items-center">
                      <div className="w-10 h-10 bg-black flex-shrink-0 border border-zinc-800 flex items-center justify-center">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[9px] text-zinc-600 font-tech">ITEM</span>
                        )}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-white text-xs font-bold truncate uppercase">{item.name}</p>
                        <p className="text-emerald-400 text-xs font-mono-tech font-bold">${item.price_sell}</p>
                      </div>
                      <div className="flex items-center gap-2 bg-black border border-zinc-700 px-1">
                        <button onClick={() => updateQuantity(item.id, -1)} className="text-zinc-400 hover:text-white px-1 font-bold">-</button>
                        <span className="text-white text-xs font-mono-tech w-4 text-center">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)} className="text-zinc-400 hover:text-white px-1 font-bold">+</button>
                      </div>
                      <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:text-red-400 p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Totals & Actions */}
              <div className="p-4 bg-zinc-900 border-t border-zinc-800">
                <div className="flex justify-between items-end mb-4">
                  <span className="text-zinc-500 font-tech text-xs tracking-wider">TOTAL A PAGAR</span>
                  <span className="text-3xl font-mono-tech font-bold text-white">${totalCart.toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER].map(method => (
                    <button
                      key={method}
                      onClick={() => setCartPaymentMethod(method)}
                      className={`py-2 text-[10px] font-tech font-bold uppercase border transition-all ${
                        cartPaymentMethod === method
                          ? 'bg-white text-black border-white'
                          : 'bg-transparent text-zinc-500 border-zinc-700 hover:border-zinc-500'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleCartCheckout}
                  disabled={cart.length === 0 || isProcessingCart}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-tech font-bold uppercase py-4 shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:shadow-none transition-all active:scale-[0.98]"
                >
                  {isProcessingCart ? 'PROCESANDO...' : 'COBRAR VENTA'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: CUSTOM ITEM FOR CART                                               */}
      {/* ========================================================================= */}
      {showCustomItemModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-zinc-950 border-2 border-yellow-500 p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-tech font-bold text-white mb-2 uppercase">AGREGAR COBRO MANUAL AL CARRITO</h3>
            <p className="text-xs text-zinc-400 font-mono-tech mb-4">
              Agrega una cuota o servicio especial para cobrarlo junto con los productos.
            </p>
            <form onSubmit={handleAddCustomCartItem} className="space-y-4">
              <div>
                <label className="block text-xs font-tech text-yellow-500 mb-1 uppercase">Concepto o Descripción</label>
                <input
                  type="text"
                  value={customItemName}
                  onChange={(e) => setCustomItemName(e.target.value)}
                  placeholder="Ej. Uso de Casillero, Abono Especial..."
                  className="w-full bg-black border border-zinc-700 p-2.5 text-white font-mono-tech text-sm outline-none focus:border-yellow-500"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-tech text-yellow-500 mb-1 uppercase">Precio / Monto ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={customItemPrice}
                  onChange={(e) => setCustomItemPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-black border border-zinc-700 p-2.5 text-white font-mono-tech text-sm outline-none focus:border-yellow-500"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowCustomItemModal(false)}
                  className="px-4 py-2 bg-zinc-900 text-zinc-400 hover:text-white text-xs font-tech font-bold uppercase"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-tech font-bold uppercase shadow-lg"
                >
                  Agregar al Carrito
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: COMPROBANTE / VOUCHER DE PAGO DIGITAL                               */}
      {/* ========================================================================= */}
      {voucherData && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-zinc-950 border-2 border-emerald-500 max-w-md w-full shadow-2xl p-6 relative">
            <div className="flex items-center gap-3 border-b border-zinc-800 pb-4 mb-4">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500 text-emerald-400 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-tech font-bold text-white uppercase tracking-wider">
                  PAGO REGISTRADO EXITOSAMENTE
                </h3>
                <p className="text-xs text-emerald-400 font-mono-tech">
                  FOLIO: {voucherData.folio}
                </p>
              </div>
            </div>

            {/* Receipt Details Box */}
            <div className="bg-black border border-zinc-800 p-4 space-y-2 font-mono-tech text-xs mb-5">
              <div className="flex justify-between border-b border-zinc-900 pb-1.5">
                <span className="text-zinc-500">FECHA Y HORA:</span>
                <span className="text-white font-bold">{voucherData.date}</span>
              </div>
              <div className="flex justify-between border-b border-zinc-900 pb-1.5">
                <span className="text-zinc-500">SOCIO:</span>
                <span className="text-yellow-400 font-bold uppercase">{voucherData.clientName}</span>
              </div>
              <div className="flex justify-between border-b border-zinc-900 pb-1.5">
                <span className="text-zinc-500">CONCEPTO:</span>
                <span className="text-white text-right max-w-[220px] truncate">{voucherData.concept}</span>
              </div>
              <div className="flex justify-between border-b border-zinc-900 pb-1.5">
                <span className="text-zinc-500">MÉTODO:</span>
                <span className="text-white font-bold">{voucherData.method}</span>
              </div>
              <div className="flex justify-between border-b border-zinc-900 pb-1.5">
                <span className="text-zinc-500">ATENDIDO POR:</span>
                <span className="text-zinc-300 font-bold">{voucherData.created_by}</span>
              </div>
              <div className="flex justify-between pt-2 items-center">
                <span className="text-zinc-400 font-tech text-sm">TOTAL COBRADO:</span>
                <span className="text-emerald-400 font-bold text-xl font-mono-tech">
                  ${voucherData.amount.toFixed(2)} MXN
                </span>
              </div>
            </div>

            <p className="text-[11px] text-zinc-500 font-mono-tech text-center mb-5">
              ✓ Ingreso asentado en el corte de caja diario y en el historial contable del socio.
            </p>

            {/* Action Buttons */}
            <div className="space-y-2">
              {voucherData.clientPhone && (
                <button
                  onClick={() => handleSendWhatsAppVoucher(voucherData)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-tech font-bold uppercase py-3 text-xs tracking-wider transition-all flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z" />
                  </svg>
                  ENVIAR COMPROBANTE POR WHATSAPP
                </button>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => handlePrintReceiptPdf(voucherData)}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-600 py-2.5 text-xs font-tech font-bold uppercase transition-all flex items-center justify-center gap-1.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  TICKET PDF
                </button>

                <button
                  onClick={() => setVoucherData(null)}
                  className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black py-2.5 text-xs font-tech font-bold uppercase transition-all shadow-md"
                >
                  ✓ ACEPTAR / CERRAR
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: HISTORIAL DE PAGOS DEL SOCIO                                       */}
      {/* ========================================================================= */}
      {viewHistoryClient && (
        <PaymentHistoryModal
          client={viewHistoryClient}
          onClose={() => setViewHistoryClient(null)}
        />
      )}
    </div>
  );
};

export default PointOfSale;
