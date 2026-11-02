import React, { useState, useEffect, useRef } from 'react';
import { Product } from '../types';
import { getProducts, saveProduct, deleteProduct } from '../services/storage';
import { useToast } from '../context/ToastContext';

const InventoryPanel: React.FC = () => {
    const { showToast } = useToast();
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Modal & Form State
    const [showModal, setShowModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Partial<Product>>({});
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const data = await getProducts();
            setProducts(data.filter(p => p.is_active)); // Only active products
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEdit = (prod: Product) => {
        setEditingProduct(prod);
        setPreviewImage(prod.image_url || null);
        setShowModal(true);
    };

    const handleNew = () => {
        setEditingProduct({
            name: '',
            category: 'OTROS',
            price_buy: 0,
            price_sell: 0,
            stock: 0,
            image_url: null
        });
        setPreviewImage(null);
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm("¿Eliminar este producto?")) return;
        try {
            await deleteProduct(id);
            showToast('Producto eliminado', 'info');
            loadData();
        } catch (e) {
            showToast('Error al eliminar', 'error');
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) setPreviewImage(ev.target.result as string);
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving) return;

        if (!editingProduct.name || !editingProduct.price_sell) {
            showToast('Nombre y Precio de Venta son obligatorios', 'warning');
            return;
        }

        setIsSaving(true);
        try {
            await saveProduct({
                id: editingProduct.id,
                name: editingProduct.name!,
                category: editingProduct.category as any || 'OTROS',
                price_buy: Number(editingProduct.price_buy || 0),
                price_sell: Number(editingProduct.price_sell || 0),
                stock: Number(editingProduct.stock || 0),
                image_url: editingProduct.image_url
            }, previewImage?.startsWith('data:') ? previewImage : undefined);

            showToast('Producto guardado correctamente', 'success');
            setShowModal(false);
            loadData();
        } catch (e: any) {
            showToast('Error al guardar: ' + e.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const labelStyle = "block text-xs font-tech text-yellow-500/80 mb-2 uppercase tracking-widest";
    const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 px-4 py-3 text-white focus:border-yellow-500 outline-none font-mono-tech";

    return (
        <div className="h-full flex flex-col animate-[fadeIn_0.5s_ease-out]">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-3xl font-tech font-bold text-white">INVENTARIO <span className="text-yellow-500">DE PRODUCTOS</span></h2>
                    <p className="text-zinc-500 font-mono-tech text-xs">GESTIÓN DE STOCK Y PRECIOS</p>
                </div>
                <button onClick={handleNew} className="bg-yellow-500 text-black px-6 py-3 font-tech font-bold uppercase hover:bg-yellow-400 shadow-lg border-2 border-white">
                    + NUEVO PRODUCTO
                </button>
            </div>

            {/* Filter Bar */}
            <div className="mb-6 bg-zinc-900/50 p-4 border border-zinc-800">
                <input 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="BUSCAR PRODUCTO POR NOMBRE..." 
                    className="w-full bg-black border border-zinc-700 p-3 text-white font-mono-tech focus:border-yellow-500 outline-none"
                />
            </div>

            {/* Table */}
            <div className="flex-1 bg-zinc-900/30 border border-zinc-800 overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="bg-zinc-950 border-b border-zinc-800 text-xs font-tech text-zinc-500 uppercase tracking-wider">
                                <th className="p-4">IMAGEN</th>
                                <th className="p-4">NOMBRE / CATEGORÍA</th>
                                <th className="p-4 text-right">COSTO</th>
                                <th className="p-4 text-right">PRECIO VENTA</th>
                                <th className="p-4 text-center">STOCK</th>
                                <th className="p-4 text-right">ACCIONES</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800 text-sm font-mono-tech text-zinc-300">
                            {isLoading ? (
                                <tr><td colSpan={6} className="p-12 text-center text-yellow-500 animate-pulse">CARGANDO INVENTARIO...</td></tr>
                            ) : filteredProducts.length === 0 ? (
                                <tr><td colSpan={6} className="p-12 text-center text-zinc-600">NO SE ENCONTRARON PRODUCTOS</td></tr>
                            ) : (
                                filteredProducts.map(p => (
                                    <tr key={p.id} className="hover:bg-white/5 transition-colors group">
                                        <td className="p-4 w-24">
                                            <div className="w-16 h-16 bg-black border border-zinc-700 flex items-center justify-center overflow-hidden">
                                                {p.image_url ? (
                                                    <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-[9px] text-zinc-600">NO IMG</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <p className="font-bold text-white text-base">{p.name}</p>
                                            <span className="text-[10px] bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded text-zinc-400 mt-1 inline-block">{p.category}</span>
                                        </td>
                                        <td className="p-4 text-right text-zinc-500">${p.price_buy}</td>
                                        <td className="p-4 text-right font-bold text-emerald-400 text-lg">${p.price_sell}</td>
                                        <td className="p-4 text-center">
                                            <span className={`px-3 py-1 font-bold ${p.stock <= 5 ? 'text-red-500 bg-red-900/20 border border-red-500' : 'text-white bg-zinc-800 border border-zinc-600'}`}>
                                                {p.stock}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button onClick={() => handleEdit(p)} className="text-yellow-500 hover:text-white mr-4 underline text-xs font-bold uppercase">EDITAR</button>
                                            <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-white underline text-xs font-bold uppercase">ELIMINAR</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MODAL */}
            {showModal && (
                <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-zinc-950 border-2 border-zinc-700 w-full max-w-2xl p-8 shadow-2xl relative">
                        <h3 className="text-2xl font-tech font-bold text-white mb-6 border-b border-zinc-800 pb-4">
                            {editingProduct.id ? 'EDITAR PRODUCTO' : 'NUEVO PRODUCTO'}
                        </h3>
                        
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="flex gap-6">
                                {/* Image Upload */}
                                <div className="w-40 flex-shrink-0">
                                    <div 
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-40 h-40 bg-black border-2 border-dashed border-zinc-700 hover:border-yellow-500 cursor-pointer flex items-center justify-center overflow-hidden transition-colors"
                                    >
                                        {previewImage ? (
                                            <img src={previewImage} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="text-center text-zinc-500">
                                                <p className="text-2xl mb-2">+</p>
                                                <p className="text-[10px] font-tech">SUBIR FOTO</p>
                                            </div>
                                        )}
                                    </div>
                                    <input ref={fileInputRef} type="file" hidden accept="image/*" onChange={handleFileChange} />
                                </div>

                                {/* Fields */}
                                <div className="flex-1 space-y-4">
                                    <div>
                                        <label className={labelStyle}>NOMBRE DEL PRODUCTO</label>
                                        <input value={editingProduct.name || ''} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} className={inputStyle} required />
                                    </div>
                                    <div>
                                        <label className={labelStyle}>CATEGORÍA</label>
                                        <select value={editingProduct.category || 'OTROS'} onChange={e => setEditingProduct({...editingProduct, category: e.target.value as any})} className={inputStyle}>
                                            <option value="BEBIDAS">BEBIDAS</option>
                                            <option value="SUPLEMENTOS">SUPLEMENTOS</option>
                                            <option value="ROPA">ROPA</option>
                                            <option value="ACCESORIOS">ACCESORIOS</option>
                                            <option value="OTROS">OTROS</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className={labelStyle}>PRECIO COMPRA</label>
                                    <input type="number" value={editingProduct.price_buy || 0} onChange={e => setEditingProduct({...editingProduct, price_buy: parseFloat(e.target.value)})} className={inputStyle} />
                                </div>
                                <div>
                                    <label className={labelStyle}>PRECIO VENTA</label>
                                    <input type="number" value={editingProduct.price_sell || 0} onChange={e => setEditingProduct({...editingProduct, price_sell: parseFloat(e.target.value)})} className={`${inputStyle} border-emerald-500/50 text-emerald-300`} required />
                                </div>
                                <div>
                                    <label className={labelStyle}>STOCK ACTUAL</label>
                                    <input type="number" value={editingProduct.stock || 0} onChange={e => setEditingProduct({...editingProduct, stock: parseInt(e.target.value)})} className={inputStyle} />
                                </div>
                            </div>

                            <div className="flex justify-end pt-4 gap-3">
                                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-3 bg-zinc-800 text-zinc-400 font-tech font-bold uppercase text-xs hover:text-white" disabled={isSaving}>CANCELAR</button>
                                <button type="submit" className="px-6 py-3 bg-yellow-500 text-black font-tech font-bold uppercase text-xs hover:bg-yellow-400 shadow-lg disabled:opacity-50" disabled={isSaving}>
                                    {isSaving ? 'GUARDANDO...' : 'GUARDAR PRODUCTO'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InventoryPanel;