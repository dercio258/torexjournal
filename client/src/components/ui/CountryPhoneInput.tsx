import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Check, Search, Globe } from 'lucide-react';
import { COUNTRIES, findCountry, filterCountries, getLocalizedCountryName } from '../../constants/countries';
import { useLocale } from '../../context/LocaleContext';

interface Country {
    name: string;
    iso2: string;
    callingCode: string;
    flag: string;
}

interface CountryPhoneInputProps {
    value?: string;
    onChange: (value: string) => void;
    onNationalChange?: (digits: string) => void;
    selectedIso2?: string | null;
    onCountryChange?: (country: { iso2: string; dialCode: string; name: string }) => void;
    error?: string;
    placeholder?: string;
    hideLabel?: boolean;
    disabled?: boolean;
    maxLength?: number;
    focusClassName?: string;
}

export const CountryPhoneInput = ({
    value,
    onChange,
    onNationalChange,
    selectedIso2,
    onCountryChange,
    error,
    placeholder,
    hideLabel = false,
    disabled = false,
    maxLength,
    focusClassName = 'focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/10',
}: CountryPhoneInputProps) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const resolvedPlaceholder = placeholder ?? (isEn ? 'Phone number' : 'Número de telefone');

    const countries: Country[] = useMemo(
        () =>
            COUNTRIES.map((c) => ({
                name: getLocalizedCountryName(c.iso2, isEn),
                iso2: c.iso2,
                callingCode: c.dialCode,
                flag: c.flagUrl,
            })),
        [isEn],
    );

    const resolveInitial = (): Country | null => {
        if (selectedIso2) {
            const matched = findCountry(selectedIso2);
            if (matched) {
                return {
                    name: getLocalizedCountryName(matched.iso2, isEn),
                    iso2: matched.iso2,
                    callingCode: matched.dialCode,
                    flag: matched.flagUrl,
                };
            }
        }
        const mz = countries.find((c) => c.iso2 === 'MZ') || countries[0] || null;
        return mz;
    };

    const [selectedCountry, setSelectedCountry] = useState<Country | null>(resolveInitial);
    const [phoneNumber, setPhoneNumber] = useState<string>(() => (value ? value.replace(/\D/g, '') : ''));
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Sync controlled national digits from parent when provided
    useEffect(() => {
        if (typeof value === 'string') {
            const clean = value.replace(/\D/g, '');
            setPhoneNumber((prev) => (prev === clean ? prev : clean));
        }
    }, [value]);

    // Sync controlled country ISO2 from parent (e.g. top Checkout country dropdown)
    useEffect(() => {
        if (!selectedIso2 || selectedIso2.toUpperCase() === 'INTL') return;
        const cleanIso2 = selectedIso2.trim().toUpperCase();
        if (selectedCountry?.iso2 === cleanIso2) return;
        const matched = findCountry(cleanIso2);
        if (!matched) return;
        const next: Country = {
            name: getLocalizedCountryName(matched.iso2, isEn),
            iso2: matched.iso2,
            callingCode: matched.dialCode,
            flag: matched.flagUrl,
        };
        setSelectedCountry(next);
        onChange(phoneNumber ? `${next.callingCode}${phoneNumber}` : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIso2, isEn]);

    // Close dropdown on click outside or Escape
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const handleSelect = (country: Country) => {
        setSelectedCountry(country);
        setIsOpen(false);
        setSearch('');
        onCountryChange?.({
            iso2: country.iso2,
            dialCode: country.callingCode,
            name: country.name,
        });
        onChange(phoneNumber ? `${country.callingCode}${phoneNumber}` : '');
    };

    const handleInputChange = (rawValue: string) => {
        let val = rawValue.replace(/\D/g, '');
        if (typeof maxLength === 'number' && maxLength > 0) {
            val = val.slice(0, maxLength);
        }
        setPhoneNumber(val);
        onNationalChange?.(val);
        onChange(val && selectedCountry ? `${selectedCountry.callingCode}${val}` : '');
    };

    const filteredCountries = useMemo(() => {
        const matches = filterCountries(search);
        const matchSet = new Set(matches.map((m) => m.iso2));
        return countries.filter((c) => matchSet.has(c.iso2));
    }, [countries, search]);

    return (
        <div className="space-y-1">
            {!hideLabel && (
                <label className="text-sm font-semibold text-gray-700 block mb-1">
                    {isEn ? 'Phone' : 'Contacto'}
                </label>
            )}
            <div
                className={`relative flex items-stretch bg-white border rounded-2xl transition-all duration-200 ${
                    error ? 'border-rose-400 focus-within:ring-4 focus-within:ring-rose-500/10' : `border-slate-200 ${focusClassName}`
                }`}
                ref={dropdownRef}
            >
                {/* Country Dropdown Trigger */}
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setIsOpen((o) => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    className="flex items-center gap-2 px-3 sm:px-3.5 py-3 sm:py-3.5 bg-slate-50 border-r border-slate-200 rounded-l-2xl hover:bg-slate-100 transition-colors min-w-[108px] sm:min-w-[116px] shrink-0 cursor-pointer disabled:opacity-60"
                >
                    {selectedCountry ? (
                        <>
                            <img
                                src={selectedCountry.flag}
                                alt={selectedCountry.iso2}
                                className="w-5 h-3.5 object-cover rounded-[2px] shadow-xs shrink-0"
                            />
                            <span className="text-sm font-bold text-slate-700 font-mono">
                                {selectedCountry.callingCode}
                            </span>
                        </>
                    ) : (
                        <Globe size={18} className="text-slate-400" />
                    )}
                    <ChevronDown
                        size={14}
                        className={`text-slate-400 ml-auto transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                    />
                </button>

                {/* Dropdown Menu */}
                {isOpen && (
                    <div className="absolute top-full left-0 mt-1.5 w-72 max-w-[calc(100vw-3rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 max-h-64 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        <div className="p-2 border-b border-slate-100 bg-slate-50/70 sticky top-0 z-10">
                            <div className="relative">
                                <Search
                                    size={14}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                                />
                                <input
                                    type="text"
                                    placeholder={isEn ? 'Search country...' : 'Buscar país...'}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div className="overflow-y-auto flex-1 p-1">
                            {filteredCountries.length === 0 ? (
                                <div className="p-4 text-center text-xs text-slate-500">
                                    {isEn ? 'No country found' : 'Nenhum país encontrado'}
                                </div>
                            ) : (
                                filteredCountries.map((country) => (
                                    <button
                                        key={country.iso2}
                                        type="button"
                                        onClick={() => handleSelect(country)}
                                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                                            selectedCountry?.iso2 === country.iso2
                                                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                                                : 'hover:bg-slate-50 text-slate-700'
                                        }`}
                                    >
                                        <img
                                            src={country.flag}
                                            alt={country.iso2}
                                            className="w-5 h-3.5 object-cover rounded-[2px] shadow-xs flex-shrink-0"
                                        />
                                        <span className="flex-1 text-xs sm:text-sm truncate">{country.name}</span>
                                        <span className="text-xs font-mono text-slate-500">{country.callingCode}</span>
                                        {selectedCountry?.iso2 === country.iso2 && (
                                            <Check size={14} className="text-indigo-600 shrink-0" />
                                        )}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* Phone Input */}
                <input
                    type="tel"
                    inputMode="numeric"
                    value={phoneNumber}
                    onChange={(e) => handleInputChange(e.target.value)}
                    placeholder={resolvedPlaceholder}
                    maxLength={maxLength}
                    disabled={disabled}
                    className="flex-1 min-w-0 px-3.5 sm:px-4 py-3 sm:py-3.5 bg-transparent rounded-r-2xl outline-none text-slate-900 text-sm sm:text-base font-bold placeholder:text-slate-400 placeholder:font-medium disabled:opacity-60"
                />
            </div>
            {error && <p className="text-xs text-rose-500 ml-1 mt-1">{error}</p>}
        </div>
    );
};
