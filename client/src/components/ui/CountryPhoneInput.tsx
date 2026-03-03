import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Search, Globe } from 'lucide-react';
import api from '../../api';

interface Country {
    name: string;
    iso2: string;
    iso3: string;
    callingCode: string;
    flag: string;
}

interface CountryPhoneInputProps {
    onChange: (value: string) => void;
    error?: string;
    placeholder?: string;
}

export const CountryPhoneInput = ({ onChange, error, placeholder = "Número de telefone" }: CountryPhoneInputProps) => {
    const [countries, setCountries] = useState<Country[]>([]);
    const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch countries on mount
    useEffect(() => {
        const fetchCountries = async () => {
            try {
                const res = await api.get('/countries');
                setCountries(res.data);

                // Set default to Mozambique (should be first based on backend sort) or find by ISO
                const defaultCountry = res.data.find((c: Country) => c.iso2 === 'MZ') || res.data[0];
                if (defaultCountry) {
                    setSelectedCountry(defaultCountry);
                }
            } catch (err) {
                console.error('Failed to load countries', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchCountries();
    }, []);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Update parent when country or phone changes
    useEffect(() => {
        if (selectedCountry) {
            // Check if phone already starts with calling code to avoid double prefix
            // Variables removed because they are never read locally
            onChange?.(phoneNumber);
            // But we keep display logic simple
            const fullNumber = `${selectedCountry.callingCode}${phoneNumber}`;
            onChange(fullNumber);
        }
    }, [selectedCountry, phoneNumber]);

    const handleSelect = (country: Country) => {
        setSelectedCountry(country);
        setIsOpen(false);
        setSearch(''); // Reset search
    };

    const filteredCountries = countries.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.callingCode.includes(search) ||
        c.iso2.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-1">
            <label className="text-sm font-semibold text-gray-700 block mb-1">
                Contacto
            </label>
            <div className="relative flex" ref={dropdownRef}>
                {/* Country Dropdown Trigger */}
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-2 px-3 py-3 bg-gray-50 border border-gray-200 border-r-0 rounded-l-xl hover:bg-gray-100 transition-colors min-w-[120px]"
                >
                    {selectedCountry ? (
                        <>
                            <img src={selectedCountry.flag} alt={selectedCountry.iso2} className="w-6 h-4 object-cover rounded-sm shadow-sm" />
                            <span className="text-sm font-medium text-gray-700">{selectedCountry.callingCode}</span>
                        </>
                    ) : (
                        isLoading ? <span className="text-xs text-gray-500">...</span> : <Globe size={20} className="text-gray-400" />
                    )}
                    <ChevronDown size={14} className={`text-gray-400 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {isOpen && (
                    <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-xl shadow-xl border border-gray-100 z-50 max-h-80 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {/* Search */}
                        <div className="p-2 border-b border-gray-100 bg-gray-50/50 sticky top-0 z-10">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar país..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500 transition-all placeholder:text-gray-400"
                                    autoFocus
                                />
                            </div>
                        </div>

                        {/* List */}
                        <div className="overflow-y-auto flex-1 p-1">
                            {filteredCountries.length === 0 ? (
                                <div className="p-4 text-center text-sm text-gray-500">Nenhum país encontrado</div>
                            ) : (
                                filteredCountries.map(country => (
                                    <button
                                        key={country.iso2}
                                        onClick={() => handleSelect(country)}
                                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${selectedCountry?.iso2 === country.iso2 ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50 text-gray-700'}`}
                                    >
                                        <img src={country.flag} alt={country.iso2} className="w-6 h-4 object-cover rounded-sm shadow-sm flex-shrink-0" />
                                        <span className="flex-1 text-sm truncate">{country.name}</span>
                                        <span className="text-xs font-mono text-gray-400">{country.callingCode}</span>
                                        {selectedCountry?.iso2 === country.iso2 && <Check size={14} className="text-emerald-500" />}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* Phone Input */}
                <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, ''); // Only numbers allowed
                        setPhoneNumber(val);
                    }}
                    placeholder={placeholder}
                    className={`flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-r-xl outline-none focus:border-emerald-500 focus:bg-white transition-all text-gray-900 placeholder:text-gray-400 ${error ? 'border-rose-300 focus:border-rose-500' : ''}`}
                />
            </div>
            {error && <p className="text-xs text-rose-500 ml-1 mt-1">{error}</p>}
        </div>
    );
};
